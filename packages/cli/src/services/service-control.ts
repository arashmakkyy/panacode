export * as ServiceControl from "./service-control"

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { chmod, mkdir, readdir, rmdir, unlink } from "node:fs/promises"
import { connect, createServer, type Server, type Socket } from "node:net"
import path from "node:path"
import { Effect } from "effect"

// A private control channel for one service instance. On Unix it is a socket inside an owner-only
// directory in Panacode's state area; on Windows it is a named pipe created by the service account.
// The channel proves that the answering process is the same account and instance that wrote the
// registration, which an HTTP response carrying a pid, product, or version cannot do.

const requestLimit = 8 * 1024
const requestTimeout = 5_000

export type Channel = {
  readonly control: { readonly path: string; readonly token: string }
  readonly close: Effect.Effect<void>
}

/** Open the control channel before the registration becomes visible. */
export const start = (options: {
  readonly file: string
  readonly id: string
  readonly shutdown: Effect.Effect<void>
}): Effect.Effect<Channel, Error> =>
  Effect.tryPromise({
    try: async () => {
      const socketPath = controlPath(options.file, options.id)
      if (!isPipe(socketPath)) {
        const directory = path.dirname(socketPath)
        await mkdir(directory, { recursive: true, mode: 0o700 })
        await chmod(directory, 0o700)
        await unlink(socketPath).catch(() => undefined)
        // An instance that died without closing leaves its endpoint behind. A live sibling
        // accepts the probe, so only dead endpoints are removed.
        await sweep(directory)
      }
      const token = randomBytes(32).toString("base64url")
      const sockets = new Set<Socket>()
      const server = createServer((socket) => {
        sockets.add(socket)
        socket.on("close", () => sockets.delete(socket))
        handle(socket, options, token)
      })
      try {
        await listen(server, socketPath)
      } catch (error) {
        // Another instance can remove the shared directory between `mkdir` and `listen` when its
        // own socket was the last entry. Recreate it and retry once.
        if (isPipe(socketPath) || !missing(error)) throw error
        const directory = path.dirname(socketPath)
        await mkdir(directory, { recursive: true, mode: 0o700 })
        await chmod(directory, 0o700)
        await listen(server, socketPath)
      }
      if (!isPipe(socketPath)) await chmod(socketPath, 0o600)
      const state = { closed: false }
      return {
        control: { path: socketPath, token },
        close: close(server, socketPath, state, sockets),
      }
    },
    catch: (cause) => new Error("Failed to open the local service control channel", { cause }),
  })

function handle(socket: Socket, options: { readonly file: string; readonly id: string; readonly shutdown: Effect.Effect<void> }, token: string) {
  let input = ""
  let done = false
  const finish = (reply: unknown) => {
    if (done) return
    done = true
    socket.end(JSON.stringify(reply) + "\n")
    setTimeout(() => socket.destroy(), 1_000).unref()
  }
  socket.setEncoding("utf8")
  const timer = setTimeout(() => finish({ ok: false, error: "timeout" }), requestTimeout)
  timer.unref()
  socket.on("data", (chunk: string) => {
    input += chunk
    if (input.length > requestLimit) return finish({ ok: false, error: "invalid" })
    const newline = input.indexOf("\n")
    if (newline < 0) return
    clearTimeout(timer)
    const request = parse(input.slice(0, newline))
    if (request === undefined || request.version !== 1 || request.id !== options.id || !sameToken(request.token, token))
      return finish({ ok: false, error: "denied" })
    if (request.action !== "ping" && request.action !== "shutdown") return finish({ ok: false, error: "denied" })
    finish({ ok: true, id: options.id, pid: process.pid, action: request.action })
    if (request.action === "shutdown") setImmediate(() => void Effect.runPromise(options.shutdown))
  })
  socket.on("error", () => finish({ ok: false, error: "invalid" }))
}

function parse(value: string) {
  try {
    const input: unknown = JSON.parse(value)
    if (typeof input !== "object" || input === null) return undefined
    if (!("version" in input) || input.version !== 1) return undefined
    if (!("id" in input) || typeof input.id !== "string") return undefined
    if (!("token" in input) || typeof input.token !== "string") return undefined
    if (!("action" in input) || typeof input.action !== "string") return undefined
    return { version: input.version, id: input.id, token: input.token, action: input.action }
  } catch {
    return undefined
  }
}

function sameToken(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function controlPath(file: string, id: string) {
  if (process.platform === "win32")
    return `\\\\.\\pipe\\panacode-${createHash("sha256").update(path.resolve(path.dirname(file))).digest("hex").slice(0, 16)}-${id}`
  return path.join(path.dirname(file), "control", `${id}.sock`)
}

function isPipe(value: string) {
  return value.startsWith("\\\\")
}

function missing(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

async function sweep(directory: string) {
  const entries = await readdir(directory).catch(() => [])
  await Promise.all(
    entries
      .filter((name) => name.endsWith(".sock"))
      .map(async (name) => {
        const file = path.join(directory, name)
        if (await listening(file)) return
        await unlink(file).catch(() => undefined)
      }),
  )
}

function listening(file: string) {
  return new Promise<boolean>((resolve) => {
    const socket = connect(file)
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.once("connect", () => finish(true))
    socket.once("error", () => finish(false))
    // A live owner that is too busy to accept still owns its endpoint.
    socket.setTimeout(1_000, () => finish(true))
  })
}

function listen(server: Server, socketPath: string) {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once("error", onError)
    server.listen(socketPath, () => {
      server.off("error", onError)
      resolve()
    })
  })
}

// A Windows named pipe disappears with its last handle; there is no filesystem entry to remove.

function close(server: Server, socketPath: string, state: { closed: boolean }, sockets: Set<Socket>) {
  return Effect.tryPromise({
    try: async () => {
      if (state.closed) return
      state.closed = true
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      if (!isPipe(socketPath)) {
        await unlink(socketPath).catch(() => undefined)
        // Leave no empty private directory behind. It stays while another live instance still
        // has its socket there.
        await rmdir(path.dirname(socketPath)).catch(() => undefined)
      }
    },
    catch: (cause) => new Error("Failed to close the local service control channel", { cause }),
  }).pipe(Effect.ignore)
}