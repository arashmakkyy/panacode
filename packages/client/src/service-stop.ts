import { PtyHandoff } from "./pty-handoff.js"
import type { Info, StopOptions } from "./service.js"
import { request } from "./service-control.js"
import { currentOwner, removeOwned, withRegistrationLock } from "./service-file.js"
import type { EnsureTiming } from "./service-timing.js"
import { setTimeout as delay } from "node:timers/promises"

/** The caller's decision is for exactly this registration generation. Serialize terminal-sidecar
 * mutations with publication, but release the lock before waiting for the owner's finalizer. */
export async function stopOwned(file: string, info: Info, pty: StopOptions["pty"], timing: EnsureTiming) {
  const requested = await withRegistrationLock(file, async () => {
    if (!(await currentOwner(file, info))) return false
    const ping = await request(info, "ping", timing.requestTimeout)
    if (!ping.ok) throw new Error(ping.message)
    if (pty === "handoff") await PtyHandoff.prepare(file, info, timing.requestTimeout)
    const terminals = pty === "shutdown" ? await request(info, "pty-shutdown", timing.requestTimeout) : undefined
    if (terminals && !terminals.ok) throw new Error(terminals.message)
    const shutdown = await request(info, "shutdown", timing.requestTimeout)
    if (!shutdown.ok) throw new Error(shutdown.message)
    if (pty !== "handoff") await PtyHandoff.clear(file)
    return true
  }).catch(async (error: unknown) => {
    // Another caller can already have received a shutdown acknowledgement. Once we let go of the
    // lock, its finalizer can retire that generation. Never unlink the live pointer just because
    // an acknowledgement arrived: a process that fails to exit must remain discoverable for retry.
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!(await currentOwner(file, info))) return false
      await delay(25)
    }
    throw error
  })
  if (!requested) return
  for (let attempt = 0; attempt <= timing.stopPollAttempts; attempt++) {
    try {
      process.kill(info.pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
      await removeOwned(file, info)
      return
    }
    if (attempt < timing.stopPollAttempts) await delay(timing.stopPollInterval)
  }
  throw new Error(`Server process ${info.pid} did not stop after an authenticated shutdown request`)
}
