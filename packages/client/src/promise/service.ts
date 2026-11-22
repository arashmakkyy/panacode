import type { DiscoverOptions, Endpoint, EnsureDiagnostic, Info, EnsureOptions, StopOptions } from "../service.js"
import { contenderPool, exitDiagnostic, spawnServiceContender } from "../service-contender.js"
import { ensureTiming, withEnsureTiming } from "../service-timing.js"
export { withEnsureTiming }
import { matchesVersion } from "../service-version.js"
import { PtyHandoff } from "../pty-handoff.js"
import { stopOwned } from "../service-stop.js"
import { currentOwner, registrationBytes, removeOwned } from "../service-file.js"
import { decide, fallback, headers, occupied, parseRegistration, probeResult, same } from "../service-probe.js"

export * from "../service.js"
export { fallback, headers }
export { publishRegistration, migrateOwnedRegistration, registrationSnapshot, registrationBytes, currentOwner } from "../service-file.js"
export { answerControl, request as requestControl, type TerminalAction } from "../service-control.js"

// Find, start, and stop the local opencode background service.
//
// The registration file is the complete discovery contract. This module is
// intentionally implemented with Node APIs so Promise clients do not need
// Effect or @effect/platform-node at runtime.

/** Discover a healthy, compatible local service without starting one. */
export async function discover(options: DiscoverOptions = {}) {
  return (await discoverInstance(options))?.endpoint
}

export async function discoverInstance(options: DiscoverOptions = {}) {
  const registration = await registered(options.file)
  if (registration.problem !== undefined) return undefined
  const found = registration.service
  if (found?.state !== "ready") return undefined
  if (!found.compatible) return undefined
  if (!matchesVersion(found.version, options)) return undefined
  if (!(await currentOwner(options.file ?? fallback(), found.info))) return undefined
  return { endpoint: found.endpoint, info: found.info }
}

/** Ensure a healthy, compatible local service is running. */
export async function ensure(options: EnsureOptions = {}): Promise<Endpoint> {
  const timing = ensureTiming(options)
  const deadline = Date.now() + timing.promiseTimeout
  const pool = contenderPool(timing)
  const started = performance.now()
  let timeouts: { readonly info: Info; readonly count: number } | undefined
  let announced = false
  let observedRegistration: string | undefined
  let observedHealth: string | undefined

  const report = (diagnostic: Omit<EnsureDiagnostic, "elapsed">) =>
    options.onDiagnostic?.({ ...diagnostic, elapsed: Math.round(performance.now() - started) })
  const announce = (reason: "missing" | "version-mismatch", previousVersion?: string) => {
    if (announced) return
    announced = true
    options.onStart?.(reason, previousVersion)
  }
  const spawnContender = async () => {
    const [command, ...args] = options.command ?? ["panacode", "serve", "--service"]
    if (command === undefined) throw new Error("Missing service command")
    try {
      const contender = spawnServiceContender(
        command,
        args,
        await PtyHandoff.environment(options.file ?? fallback(), options.env),
      )
      report({ stage: "spawn", pid: contender.child.pid })
      return contender
    } catch (cause) {
      throw new Error("Failed to start server", { cause })
    }
  }

  try {
    while (true) {
      if (Date.now() >= deadline) throw pool.failure() ?? pool.timeout()
      const registration = await registered(options.file, timing.requestTimeout)
      if (registration.info !== undefined) {
        const identity = `${registration.info.id ?? "?"}:${registration.info.pid}`
        if (identity !== observedRegistration) {
          observedRegistration = identity
          report({ stage: "register", pid: registration.info.pid, state: registration.service?.state })
        }
      }
      if (registration.problem !== undefined) {
        // A damaged record is never adopted or controlled. When its loopback endpoint still accepts
        // connections, another process may own the port, so refuse. A free port is safe to reuse: the
        // replacement publishes its own owned registration atomically once it binds.
        const origin = registration.url
        if (origin !== undefined && (await occupied(origin)))
          throw new Error(
            `${registration.problem} The registered endpoint still accepts connections; refusing to reuse or replace it.`,
          )
      }
      if (registration.timedOut && registration.info !== undefined) {
        timeouts = {
          info: registration.info,
          count: timeouts !== undefined && same(timeouts.info, registration.info) ? timeouts.count + 1 : 1,
        }
        if (timeouts.count >= 3) {
          announce("missing")
          console.warn("Background service is unresponsive; recovery cannot preserve persistent terminals")
          await stopOwned(options.file ?? fallback(), registration.info, "clear", timing)
          pool.evict(registration.info.pid)
          pool.recruitNow()
          timeouts = undefined
        }
      } else timeouts = undefined

      if (registration.service !== undefined) {
        pool.serviceAnswered()
        const service = registration.service
        const identity = `${service.info.id ?? "?"}:${service.info.pid}:${service.state}`
        if (identity !== observedHealth) {
          observedHealth = identity
          report({ stage: "health", pid: service.info.pid, state: service.state })
        }
        const decision = decide(service, options)
        // A contender this call spawned can answer before it publishes its own registration. That
        // endpoint is ours, not a foreign owner, so keep polling instead of failing on the stale
        // record. Adoption still waits for a matching registration.
        if (
          decision._tag === "fail" &&
          !(service.unverified && pool.pending()) &&
          (service.answeredPid === undefined || !pool.has(service.answeredPid))
        )
          throw decision.error
        if (decision._tag === "reuse") {
          if (!(await PtyHandoff.complete(options.file ?? fallback(), service.info))) continue
          report({ stage: "ready", pid: service.info.pid })
          return service.endpoint
        }
        if (decision._tag === "replace") {
          announce("version-mismatch", service.version)
          if (service.state !== "ready")
            console.warn("Background service is not ready; replacement cannot preserve persistent terminals")
          await stopOwned(options.file ?? fallback(), service.info, decision.pty, timing)
          pool.evict(service.info.pid)
        }
      } else {
        const failed = pool.reap()
        if (failed !== undefined) throw failed
        if (pool.shouldRecruit(registration.info !== undefined)) {
          announce("missing")
          pool.add(await spawnContender())
        }
      }
      await delay(timing.pollInterval)
    }
  } catch (error) {
    report({
      stage: "exit",
      ...exitDiagnostic(error),
    })
    throw error
  } finally {
    pool.releaseAll()
  }
}

/** Stop the registered local service. */
export async function stop(options: StopOptions = {}) {
  const registration = await read(options.file)
  if (registration.problem !== undefined)
    throw new Error(`${registration.problem} Refusing to stop an unidentified process.`)
  const info = options.expected ?? registration.info
  if (info !== undefined) await stopOwned(options.file ?? fallback(), info, options.pty, ensureTiming(options))
}

async function read(file?: string) {
  const bytes = await registrationBytes(file ?? fallback())
  return bytes ? parseRegistration(bytes.toString("utf8")) : {}
}

async function registered(file?: string, timeout?: number) {
  const registration = await read(file)
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
  return { info, ...(await probeResult(info, timeout)) }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

/** Promise-based local service lifecycle operations. */
export const Service = { discover, discoverInstance, ensure, stop, headers, removeOwned }
