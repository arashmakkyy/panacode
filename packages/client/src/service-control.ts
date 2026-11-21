import { connect } from "node:net"
import type { Info } from "./service.js"

// The local control channel is separate from the public HTTP API. It only exists for a
// registration written by the service itself, is bound to one instance id, and lives in a
// private Panacode directory (or a Windows named pipe owned by the same account). A public
// password, product string, version, or PID is never enough to stop a process.

const responseLimit = 8 * 1024

export type ControlResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason: "unavailable" | "denied" | "mismatch"
      readonly message: string
    }

/** Ask a registered Panacode instance to answer or shut down over its private control channel. */
export function request(info: Info, action: "ping" | "shutdown", timeout: number): Promise<ControlResult> {
  const control = info.control
  const id = info.id
  if (control === undefined || id === undefined)
    return Promise.resolve({
      ok: false,
      reason: "unavailable",
      message: "The local service registration has no control channel; refusing to stop an unidentified process.",
    })
  return new Promise((resolve) => {
    let settled = false
    let buffer = ""
    const socket = connect(control.path)
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          reason: "unavailable",
          message: "Timed out waiting for the local service control channel.",
        }),
      timeout,
    )
    const finish = (result: ControlResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(result)
    }
    socket.setEncoding("utf8")
    socket.on("connect", () => {
      socket.write(JSON.stringify({ version: 1, id, token: control.token, action }) + "\n")
    })
    socket.on("data", (chunk: string) => {
      buffer += chunk
      if (buffer.length > responseLimit)
        return finish({ ok: false, reason: "denied", message: "The local service control channel sent an invalid reply." })
      const newline = buffer.indexOf("\n")
      if (newline < 0) return
      finish(readReply(buffer.slice(0, newline), info))
    })
    socket.on("error", () =>
      finish({
        ok: false,
        reason: "unavailable",
        message: "The local service control channel is not available; refusing to stop an unidentified process.",
      }),
    )
    socket.on("close", () =>
      finish({
        ok: false,
        reason: "unavailable",
        message: "The local service control channel closed before the service answered.",
      }),
    )
  })
}

function readReply(line: string, info: Info): ControlResult {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return { ok: false, reason: "denied", message: "The local service control channel sent an invalid reply." }
  }
  if (typeof value !== "object" || value === null)
    return { ok: false, reason: "denied", message: "The local service control channel sent an invalid reply." }
  if ("ok" in value && value.ok === false)
    return { ok: false, reason: "denied", message: "The local service control channel rejected the request." }
  if (!("ok" in value) || value.ok !== true)
    return { ok: false, reason: "denied", message: "The local service control channel sent an invalid reply." }
  // The reply must name the exact instance and process from the private registration. A process
  // that merely took over the registered port cannot answer on the same private channel.
  if (!("id" in value) || value.id !== info.id || !("pid" in value) || value.pid !== info.pid)
    return {
      ok: false,
      reason: "mismatch",
      message: "The local service control channel belongs to a different instance; refusing to stop it.",
    }
  return { ok: true }
}