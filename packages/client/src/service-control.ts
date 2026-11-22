import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { isAbsolute } from "node:path"
import { connect, type Socket } from "node:net"
import type { Info } from "./service.js"

export type TerminalAction = "pty-handoff" | "pty-shutdown"
type Action = "ping" | "shutdown" | TerminalAction
type Identity = Pick<Info, "id" | "pid" | "url" | "version" | "product" | "password">
export type ControlResult =
  | { readonly ok: true; readonly value?: unknown }
  | {
      readonly ok: false
      readonly reason: "unavailable" | "denied" | "mismatch"
      readonly message: string
    }

const nonce = () => randomBytes(32).toString("hex")
function challenge(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}

function proof(key: string, info: Identity, role: string, client: string, server: string, action: Action) {
  return createHmac("sha256", key)
    .update(
      JSON.stringify([
        "panacode-control-v2",
        role,
        info.product,
        info.id,
        info.pid,
        info.url,
        info.version,
        info.password,
        client,
        server,
        action,
      ]),
    )
    .digest("hex")
}

// The handoff ticket is secret. Bind its encrypted reply to this one authenticated exchange.
function replyKey(key: string, info: Identity, client: string, server: string, action: Action) {
  return Buffer.from(proof(key, info, "terminal-reply", client, server, action), "hex")
}

function seal(key: Buffer, value: unknown) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  return Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString(
    "base64",
  )
}

function unseal(key: Buffer, text: string): unknown {
  const bytes = Buffer.from(text, "base64")
  const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12))
  cipher.setAuthTag(bytes.subarray(-16))
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString("utf8"))
}

function valid(value: unknown, expected: string) {
  return challenge(value) && timingSafeEqual(Buffer.from(value), Buffer.from(expected))
}

// Each connection has at most two small frames in each direction. Neither peer sends a reusable
// secret. Separate direction and action tags and two fresh nonces bind both proofs to this exchange.
function frames(socket: Socket, receive: (message: Record<string, unknown>) => void) {
  let buffer = ""
  socket.setEncoding("utf8")
  socket.on("data", (chunk: string) => {
    buffer += chunk
    if (buffer.length > 8192) return socket.destroy()
    let newline: number
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      try {
        const message: unknown = JSON.parse(line)
        if (!message || typeof message !== "object" || Array.isArray(message)) return socket.destroy()
        receive(message as Record<string, unknown>)
      } catch {
        return socket.destroy()
      }
    }
  })
}

function send(socket: Socket, message: Record<string, unknown>) {
  socket.write(JSON.stringify(message) + "\n")
}

export function answerControl(
  socket: Socket,
  info: Identity,
  key: string,
  shutdown: () => void,
  terminals?: (action: TerminalAction) => Promise<unknown>,
) {
  const server = nonce()
  let client: string | undefined
  let action: Action
  let finished = false
  const timer = setTimeout(() => socket.destroy(), 5_000)
  timer.unref()
  socket.once("close", () => clearTimeout(timer))
  socket.on("error", () => socket.destroy())
  frames(socket, (message) => {
    if (finished) return
    if (client === undefined) {
      if (
        message.version !== 2 ||
        !challenge(message.nonce) ||
        (message.action !== "ping" &&
          message.action !== "shutdown" &&
          message.action !== "pty-handoff" &&
          message.action !== "pty-shutdown")
      )
        return socket.destroy()
      client = message.nonce
      action = message.action
      send(socket, { nonce: server, proof: proof(key, info, "server", client, server, action) })
      return
    }
    finished = true
    if (!valid(message.proof, proof(key, info, "client", client, server, action))) return socket.destroy()
    const accepted = proof(key, info, "accepted", client, server, action)
    if (action === "pty-handoff" || action === "pty-shutdown") {
      if (!terminals) return socket.destroy()
      const reply = replyKey(key, info, client, server, action)
      void terminals(action)
        .then((value) => {
          socket.end(JSON.stringify({ proof: accepted, result: seal(reply, value ?? null) }) + "\n")
        })
        .catch(() => socket.destroy())
      return
    }
    socket.end(JSON.stringify({ proof: accepted }) + "\n")
    if (action === "shutdown") setImmediate(shutdown)
  })
}

export async function request(info: Info, action: Action, timeout: number): Promise<ControlResult> {
  const control = info.control
  if (info.product !== "panacode" || !info.id || !control)
    return {
      ok: false,
      reason: "unavailable",
      message: "The local service registration has no verified control channel.",
    }
  const validPath =
    process.platform === "win32" ? control.path.startsWith("\\\\.\\pipe\\panacode-") : isAbsolute(control.path)
  if (!validPath) return { ok: false, reason: "denied", message: "Invalid private service control path." }
  try {
    return await exchange(connect(control.path), info, control.token, action, timeout)
  } catch {
    return { ok: false, reason: "unavailable", message: "Invalid or unavailable private service control channel." }
  }
}

/** Perform the mutual proof on an already connecting stream. Production always connects to local IPC. */
export function exchange(
  socket: Socket,
  info: Info,
  key: string,
  action: Action,
  timeout: number,
): Promise<ControlResult> {
  return new Promise((resolve) => {
    const client = nonce()
    let server: string | undefined
    const unavailable = () =>
      finish({ ok: false, reason: "unavailable", message: "The local service control channel is unavailable." })
    const denied = () =>
      finish({
        ok: false,
        reason: "mismatch",
        message: "The local service control channel belongs to a different instance or endpoint.",
      })
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          reason: "unavailable",
          message: "Timed out waiting for the local service control channel.",
        }),
      timeout,
    )
    function finish(result: ControlResult) {
      clearTimeout(timer)
      socket.destroy()
      resolve(result)
    }
    socket.once("error", unavailable)
    socket.once("close", unavailable)
    socket.once("connect", () => send(socket, { version: 2, nonce: client, action }))
    frames(socket, (message) => {
      if (server === undefined) {
        if (
          !challenge(message.nonce) ||
          !valid(message.proof, proof(key, info, "server", client, message.nonce, action))
        )
          return denied()
        server = message.nonce
        send(socket, { proof: proof(key, info, "client", client, server, action) })
        return
      }
      if (!valid(message.proof, proof(key, info, "accepted", client, server, action))) return denied()
      if (action === "pty-handoff" || action === "pty-shutdown") {
        if (typeof message.result !== "string") return denied()
        try {
          return finish({ ok: true, value: unseal(replyKey(key, info, client, server, action), message.result) })
        } catch {
          return denied()
        }
      }
      finish({ ok: true })
    })
  })
}
