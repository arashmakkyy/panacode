import { Effect, Option, Schedule, Schema } from "effect"
import type { DiscoverOptions, EnsureDiagnostic, EnsureOptions, StopOptions } from "../service.js"
import { contenderPool, exitDiagnostic, spawnServiceContender } from "../service-contender.js"
import { ensureTiming } from "../service-timing.js"
import { matchesVersion } from "../service-version.js"
import { PtyHandoff } from "../pty-handoff.js"
import { stopOwned } from "../service-stop.js"
import { currentOwner, registrationBytes, removeOwned } from "../service-file.js"
import {
  decide,
  fallback,
  headers,
  localEndpoint,
  occupied,
  parseRegistration,
  probeResult,
  same,
} from "../service-probe.js"

export * from "../service.js"
export { headers }
/** Contents of the local service registration file. */
export type Info = typeof Info.Type

// Find, start, and stop the local opencode background service.
//
// The service daemon advertises itself through a registration file in the
// user's state directory: url, pid, version, and the private password, with
// 0600 permissions. That file is the complete discovery contract — reading it
// is all a client needs to connect. The daemon's own configuration (port,
// persisted password) is CLI-owned and never read here.

// Read-only lookup: registration file plus health check and version gate.
// Never spawns; escalation to ensure() is the caller's policy.
/** Discover a healthy, compatible local service without starting one. */
export const discoverInstance = Effect.fn("service.discoverInstance")(function* (options: DiscoverOptions = {}) {
  const registration = yield* registered(options.file)
  if (registration.problem !== undefined) return undefined
  const found = registration.service
  if (found?.state !== "ready") return undefined
  if (!found.compatible) return undefined
  if (!matchesVersion(found.version, options)) return undefined
  if (!(yield* Effect.tryPromise(() => currentOwner(options.file ?? fallback(), found.info)))) return undefined
  return { info: found.info, endpoint: found.endpoint }
})

export const discover = (options: DiscoverOptions = {}) =>
  discoverInstance(options).pipe(Effect.map((found) => found?.endpoint))

/** Recognize an authenticated compatible service bound to an expected URL, including while it starts or fails. */
export const incumbent = Effect.fn("service.incumbent")(function* (
  options: DiscoverOptions & { readonly url: string },
) {
  const registration = yield* read(options.file)
  if (registration.problem !== undefined) {
    // An unidentified registration is never adopted. Probe the configured port without a
    // credential so the caller can still distinguish an occupied port from a free one.
    yield* Effect.promise(() => occupied(options.url))
    return undefined
  }
  const info = registration.info
  if (info === undefined) return undefined
  const origin = localEndpoint(info)
  const expected = localEndpoint({ url: options.url })
  if (!origin || !expected || new URL(origin).origin !== new URL(expected).origin) return undefined
  const found = (yield* Effect.promise(() => probeResult(info))).service
  if (!found?.compatible || found.error) return undefined
  if (!matchesVersion(found.version, options)) return undefined
  if (!(yield* Effect.tryPromise(() => currentOwner(options.file ?? fallback(), found.info)))) return undefined
  return { endpoint: found.endpoint, state: found.state }
})

// Idempotent ensure-running: reuses a healthy compatible server, replaces a
// version-mismatched one, and otherwise spawns small contenders until a server
// becomes discoverable. A contender is never killed merely for slow startup.
/** Discover a healthy, compatible local service that also answers on its private control channel. */
export const verified = discover

export const verifiedRegistration = (options: DiscoverOptions = {}) =>
  discoverInstance(options).pipe(Effect.map((found) => found?.info))

/** Ensure a healthy, compatible local service is running. */
export const ensureInstance = Effect.fn("service.ensureInstance")(function* (options: EnsureOptions = {}) {
  const timing = ensureTiming(options)
  const pool = contenderPool(timing)
  const started = performance.now()
  let timeouts: { readonly info: Info; readonly count: number } | undefined
  let announced = false
  let observedRegistration: string | undefined
  let observedHealth: string | undefined
  const report = (diagnostic: Omit<EnsureDiagnostic, "elapsed">) =>
    Effect.sync(() => options.onDiagnostic?.({ ...diagnostic, elapsed: Math.round(performance.now() - started) }))
  const announce = (reason: "missing" | "version-mismatch", previousVersion?: string) =>
    Effect.sync(() => {
      if (announced) return
      announced = true
      options.onStart?.(reason, previousVersion)
    })
  const spawnContender = Effect.gen(function* () {
    const [command, ...args] = options.command ?? ["panacode", "serve", "--service"]
    if (command === undefined) return yield* Effect.fail(new Error("Missing service command"))
    const env = yield* Effect.tryPromise(() => PtyHandoff.environment(options.file ?? fallback(), options.env))
    const contender = yield* Effect.try({
      try: () => {
        return spawnServiceContender(command, args, env)
      },
      catch: (cause) => new Error("Failed to start server", { cause }),
    })
    yield* report({ stage: "spawn", pid: contender.child.pid })
    return contender
  })
  const found = yield* Effect.gen(function* () {
    const registration = yield* registered(options.file, timing.requestTimeout)
    if (registration.problem !== undefined) {
      // A damaged record is never adopted or controlled. When its loopback endpoint still accepts
      // connections, another process may own the port, so refuse. A free port is safe to reuse: the
      // replacement publishes its own owned registration atomically once it binds.
      const origin = registration.url
      if (origin !== undefined && (yield* Effect.promise(() => occupied(origin))))
        return yield* Effect.fail(
          new Error(
            `${registration.problem} The registered endpoint still accepts connections; refusing to reuse or replace it.`,
          ),
        )
    }
    const info = registration.info
    const service = registration.service
    if (info !== undefined) {
      const identity = `${info.id ?? "?"}:${info.pid}`
      if (identity !== observedRegistration) {
        observedRegistration = identity
        yield* report({ stage: "register", pid: info.pid, state: service?.state })
      }
    }
    if (registration.timedOut && info !== undefined) {
      timeouts = {
        info,
        count: timeouts !== undefined && same(timeouts.info, info) ? timeouts.count + 1 : 1,
      }
      if (timeouts.count >= 3) {
        yield* announce("missing")
        yield* Effect.logWarning("Background service is unresponsive; recovery cannot preserve persistent terminals")
        yield* Effect.tryPromise(() => stopOwned(options.file ?? fallback(), info, "clear", timing))
        pool.evict(info.pid)
        pool.recruitNow()
        timeouts = undefined
      }
    } else timeouts = undefined
    if (service !== undefined) {
      pool.serviceAnswered(service.unverified)
      const identity = `${service.info.id ?? "?"}:${service.info.pid}:${service.state}`
      if (identity !== observedHealth) {
        observedHealth = identity
        yield* report({ stage: "health", pid: service.info.pid, state: service.state })
      }
      const decision = decide(service, options)
      if (decision._tag === "fail") {
        if (service.unverified && pool.awaitingPublication()) return Option.none()
        return yield* Effect.fail(decision.error)
      }
      if (decision._tag === "reuse") {
        if (!(yield* Effect.tryPromise(() => PtyHandoff.complete(options.file ?? fallback(), service.info))))
          return Option.none()
        yield* report({ stage: "ready", pid: service.info.pid })
        return Option.some(service)
      }
      if (decision._tag === "replace") {
        yield* announce("version-mismatch", service.version)
        if (service.state !== "ready")
          yield* Effect.logWarning("Background service is not ready; replacement cannot preserve persistent terminals")
        yield* Effect.tryPromise(() => stopOwned(options.file ?? fallback(), service.info, decision.pty, timing))
        pool.evict(service.info.pid)
      }
      return Option.none()
    }

    const failed = pool.reap()
    if (failed !== undefined) return yield* Effect.fail(failed)
    if (pool.shouldRecruit(info !== undefined)) {
      yield* announce("missing")
      pool.add(yield* spawnContender)
    }
    return Option.none()
  }).pipe(
    Effect.tapError((error) => report({ stage: "exit", ...exitDiagnostic(error) })),
    Effect.repeat({
      until: Option.isSome,
      // Probes run sequentially, so a slow probe stretches each iteration; bound the loop by wall clock
      // like the Promise variant rather than by attempt count.
      schedule: Schedule.spaced(timing.pollInterval).pipe(Schedule.upTo({ duration: timing.promiseTimeout })),
    }),
    Effect.ensuring(Effect.sync(() => pool.releaseAll())),
  )
  if (Option.isNone(found)) {
    const failure = pool.failure() ?? pool.timeout()
    yield* report({ stage: "exit", ...exitDiagnostic(failure) })
    return yield* Effect.fail(failure)
  }
  return { endpoint: found.value.endpoint, info: found.value.info }
})

export const ensure = (options: EnsureOptions = {}) =>
  ensureInstance(options).pipe(Effect.map((found) => found.endpoint))

/** Stop the registered local service. */
export const stop = Effect.fn("service.stop")(function* (options: StopOptions = {}) {
  const registration = yield* read(options.file)
  if (registration.problem !== undefined)
    return yield* Effect.fail(new Error(`${registration.problem} Refusing to stop an unidentified process.`))
  const info = options.expected ?? registration.info
  if (info !== undefined)
    yield* Effect.tryPromise({
      try: () => stopOwned(options.file ?? fallback(), info, options.pty, ensureTiming(options)),
      catch: (cause) => (cause instanceof Error ? cause : new Error("Failed to stop service", { cause })),
    })
})

/** Schema for the local service registration file. */
export const Info = Schema.Struct({
  id: Schema.optional(Schema.String),
  product: Schema.optional(Schema.Literal("panacode")),
  version: Schema.optional(Schema.String),
  url: Schema.String,
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  password: Schema.optional(Schema.String),
  control: Schema.optional(
    Schema.Struct({
      path: Schema.String,
      token: Schema.String,
    }),
  ),
})

// A missing file means no service. An unreadable or foreign file is a distinct "unowned"
// problem, so lifecycle operations do not treat it as permission to start or stop anything.
const read = Effect.fnUntraced(function* (file?: string) {
  const bytes = yield* Effect.tryPromise(() => registrationBytes(file ?? fallback()))
  return bytes ? parseRegistration(bytes.toString("utf8")) : {}
})

const registered = Effect.fnUntraced(function* (file?: string, timeout?: number) {
  const registration = yield* read(file)
  if (registration.problem !== undefined)
    return {
      info: undefined,
      service: undefined,
      timedOut: false,
      problem: registration.problem,
      url: registration.url,
    }
  const info = registration.info
  if (info === undefined) return { info: undefined, service: undefined, timedOut: false }
  return { info, ...(yield* Effect.promise(() => probeResult(info, timeout))) }
})

/** Effect-based local service lifecycle operations. */
export const Service = {
  discover,
  discoverInstance,
  incumbent,
  ensure,
  ensureInstance,
  stop,
  verified,
  verifiedRegistration,
  headers,
  removeOwned,
  Info,
}
