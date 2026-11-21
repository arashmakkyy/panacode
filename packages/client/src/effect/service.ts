import { Effect, FileSystem, Option, Schedule, Schema } from "effect"
import type { DiscoverOptions, EnsureDiagnostic, EnsureOptions, StopOptions } from "../service.js"
import { contenderPool, spawnServiceContender } from "../service-contender.js"
import { defaultEnsureTiming, ensureTiming, type EnsureTiming } from "../service-timing.js"
import { matchesVersion } from "../service-version.js"
import { PtyHandoff } from "../pty-handoff.js"
import { request } from "../service-control.js"
import { removeOwned } from "../service-file.js"
import { decide, fallback, headers, occupied, parseRegistration, probeResult, same } from "../service-probe.js"

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
export const discover = Effect.fn("service.discover")(function* (options: DiscoverOptions = {}) {
  const registration = yield* registered(options.file)
  if (registration.problem !== undefined) return undefined
  const found = registration.service
  if (found?.state !== "ready") return undefined
  if (!found.compatible) return undefined
  if (!matchesVersion(found.version, options)) return undefined
  return found.endpoint
})

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
  const found = (yield* Effect.promise(() => probeResult({ ...info, url: options.url }))).service
  if (!found?.compatible) return undefined
  if (!matchesVersion(found.version, options)) return undefined
  return { endpoint: found.endpoint, state: found.state }
})

// Idempotent ensure-running: reuses a healthy compatible server, replaces a
// version-mismatched one, and otherwise spawns small contenders until a server
// becomes discoverable. A contender is never killed merely for slow startup.
/** Discover a healthy, compatible local service that also answers on its private control channel. */
export const verified = Effect.fn("service.verified")(function* (options: DiscoverOptions = {}) {
  const registration = yield* read(options.file)
  if (registration.problem !== undefined) return undefined
  const info = registration.info
  if (info === undefined) return undefined
  const service = (yield* Effect.promise(() => probeResult(info))).service
  if (service?.state !== "ready" || !service.compatible) return undefined
  if (!matchesVersion(service.version, options)) return undefined
  const ping = yield* Effect.tryPromise(() => request(info, "ping", defaultEnsureTiming.requestTimeout))
  return ping.ok ? service.endpoint : undefined
})

/** Ensure a healthy, compatible local service is running. */
export const ensure = Effect.fn("service.ensure")(function* (options: EnsureOptions = {}) {
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
          new Error(`${registration.problem} The registered endpoint still accepts connections; refusing to reuse or replace it.`),
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
        yield* Effect.tryPromise(() => PtyHandoff.clear(options.file ?? fallback()))
        yield* terminate(info, options, timing, false)
        pool.evict(info.pid)
        pool.recruitNow()
        timeouts = undefined
      }
    } else timeouts = undefined
    if (service !== undefined) {
      pool.serviceAnswered()
      const identity = `${service.info.id ?? "?"}:${service.info.pid}:${service.state}`
      if (identity !== observedHealth) {
        observedHealth = identity
        yield* report({ stage: "health", pid: service.info.pid, state: service.state })
      }
      const decision = decide(service, options)
      if (decision._tag === "fail") return yield* Effect.fail(decision.error)
      if (decision._tag === "reuse") {
        yield* Effect.tryPromise(() => PtyHandoff.complete(options.file ?? fallback(), service.info))
        yield* report({ stage: "ready", pid: service.info.pid })
        return Option.some(service)
      }
      if (decision._tag === "replace") {
        yield* announce("version-mismatch", service.version)
        if (service.state !== "ready")
          yield* Effect.logWarning("Background service is not ready; replacement cannot preserve persistent terminals")
        yield* stop({ file: options.file, pty: decision.pty }).pipe(Effect.ignore)
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
    Effect.tapError((error) => report({ stage: "exit", reason: error.message.split("\n", 1)[0] })),
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
    yield* report({ stage: "exit", reason: failure.message.split("\n", 1)[0] })
    return yield* Effect.fail(failure)
  }
  return found.value.endpoint
})

/** Stop the registered local service. */
export const stop = Effect.fn("service.stop")(function* (options: StopOptions = {}) {
  const registration = yield* read(options.file)
  if (registration.problem !== undefined)
    return yield* Effect.fail(new Error(`${registration.problem} Refusing to stop an unidentified process.`))
  const info = registration.info
  const ping =
    info === undefined
      ? undefined
      : yield* Effect.tryPromise(() => request(info, "ping", defaultEnsureTiming.requestTimeout))
  // Terminal handoff reaches the service over HTTP, so it follows a successful private-channel
  // ping for the same instance and process.
  yield* Effect.tryPromise(() =>
    ping?.ok === true && options.pty === "handoff" && info !== undefined
      ? PtyHandoff.prepare(options.file ?? fallback(), info, defaultEnsureTiming.requestTimeout)
      : PtyHandoff.clear(options.file ?? fallback()),
  ).pipe(Effect.catch((cause) => Effect.logWarning("Failed to prepare persistent terminals for replacement", cause)))
  if (info !== undefined) yield* terminate(info, options, ensureTiming(options), ping?.ok === true)
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
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(file ?? fallback()).pipe(Effect.option)
  if (Option.isNone(text)) return {}
  return parseRegistration(text.value)
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

// 50ms cadence bounded at ~5s, shared by stop escalation and each ensure
// discovery window.
const poll = (timing: EnsureTiming) =>
  Schedule.max([Schedule.spaced(timing.stopPollInterval), Schedule.recurs(timing.stopPollAttempts)])

const stopped = Effect.fnUntraced(function* (pid: number) {
  const running = yield* Effect.try({ try: () => process.kill(pid, 0), catch: () => false }).pipe(
    Effect.orElseSucceed(() => false),
  )
  if (!running) return true
  return yield* Effect.fail(new Error(`Server process ${pid} is still running`))
})

const terminate = Effect.fnUntraced(function* (
  info: Info,
  options: { readonly file?: string },
  timing: EnsureTiming,
  verified: boolean,
) {
  const current = (yield* read(options.file)).info
  if (current === undefined || !same(current, info)) return
  if (!verified) {
    const ping = yield* Effect.tryPromise(() => request(info, "ping", timing.requestTimeout))
    if (!ping.ok) return yield* Effect.fail(new Error(ping.message))
  }
  const shutdown = yield* Effect.tryPromise(() => request(info, "shutdown", timing.requestTimeout))
  if (!shutdown.ok) return yield* Effect.fail(new Error(shutdown.message))
  // Waiting for the process to exit is observation only. A service that does not honor its own
  // authenticated shutdown request is left running with a clear error, never killed by PID.
  const done = yield* stopped(info.pid).pipe(Effect.retry(poll(timing)), Effect.option)
  if (Option.isNone(done))
    return yield* Effect.fail(
      new Error(`Server process ${info.pid} did not stop after an authenticated shutdown request`),
    )
  yield* Effect.tryPromise(() => removeOwned(options.file ?? fallback(), info)).pipe(Effect.ignore)
})

/** Effect-based local service lifecycle operations. */
export const Service = { discover, incumbent, ensure, stop, verified, headers, removeOwned, Info }
