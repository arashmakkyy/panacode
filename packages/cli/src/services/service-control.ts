export * as ServiceControl from "./service-control"

import { createHash } from "node:crypto"
import { chmod, lstat, readdir, rmdir, unlink } from "node:fs/promises"
import { connect, createServer, type Server, type Socket } from "node:net"
import path from "node:path"
import { privateDirectory } from "@opencode/util/private-directory"
import { answerControl, type Info, type TerminalAction } from "@opencode/client/service"
import { Effect } from "effect"

// A private control channel for one service instance. On Unix it is a socket inside an owner-only
// directory in Panacode's state area; on Windows it is a named pipe created by the service account.
// The channel proves that the answering process is the same account and instance that wrote the
// registration, which an HTTP response carrying a pid, product, or version cannot do.

type Identity = Pick<Info, "product" | "version" | "url" | "pid" | "password"> & { readonly id: string }

export type Channel = {
  readonly control: { readonly path: string; readonly token: string }
  readonly close: Effect.Effect<void>
}

/** Open the control channel before the registration becomes visible. */
export const start = (options: {
  readonly file: string
  readonly terminals?: (action: TerminalAction) => Promise<unknown>
  readonly token: string
  readonly identity: Identity
  readonly shutdown: Effect.Effect<void>
}): Effect.Effect<Channel, Error> =>
  Effect.tryPromise({
    try: async () => {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(options.identity.id)) throw new Error("Invalid service instance ID")
      const socketPath = controlPath(options.file, options.identity.id)
      if (!isPipe(socketPath)) {
        const directory = path.dirname(socketPath)
        await ensureControlDirectory(directory)
        await sweep(privateDirectory(directory))
      }
      const token = options.token
      const sockets = new Set<Socket>()
      const server = createServer((socket) => {
        sockets.add(socket)
        socket.on("close", () => sockets.delete(socket))
        answerControl(
          socket,
          options.identity,
          token,
          () => void Effect.runPromise(options.shutdown),
          options.terminals,
        )
      })
      try {
        await listen(server, socketPath)
      } catch (error) {
        // Another instance can remove the shared directory between `mkdir` and `listen` when its
        // own socket was the last entry. Recreate it and retry once.
        if (isPipe(socketPath) || !missing(error)) throw error
        const directory = path.dirname(socketPath)
        await ensureControlDirectory(directory)
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

function ensureControlDirectory(directory: string) {
  const verified = privateDirectory(directory, true)
  return lstat(verified).then((stat) => {
    if (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
      throw new Error("Control directory is not private")
  })
}

function controlPath(file: string, id: string) {
  const directory = path.dirname(file)
  const scope = createHash("sha256").update(path.resolve(directory)).digest("hex").slice(0, 16)
  if (process.platform === "win32") return `\\\\.\\pipe\\panacode-${scope}-${id}`
  const socket = path.join(directory, "control", `${id}.sock`)
  // sockaddr_un.sun_path is 104 bytes including NUL on macOS. Nested private profiles can
  // exceed it even on ordinary user homes. The same owner-only directory checks apply in /tmp.
  if (Buffer.byteLength(socket) < 104) return socket
  const short = path.join("/tmp", `panacode-${process.getuid?.()}-${scope}`)
  return path.join(short, id.length <= 36 ? id + ".sock" : createHash("sha256").update(id).digest("hex").slice(0, 32) + ".sock")
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
      .filter((name) => /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.sock$/i.test(name))
      .map(async (name) => {
        const file = path.join(directory, name)
        const stat = await lstat(file).catch(() => undefined)
        if (!stat?.isSocket() || stat.uid !== process.getuid?.() || (await listening(file))) return
        const current = await lstat(file).catch(() => undefined)
        if (!current || current.dev !== stat.dev || current.ino !== stat.ino) return
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
    socket.once("error", (error: NodeJS.ErrnoException) => finish(error.code !== "ECONNREFUSED"))
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
        // Leave no empty private directory behind. It stays while another live instance still
        // has its socket there.
        await rmdir(privateDirectory(path.dirname(socketPath))).catch(() => undefined)
      }
    },
    catch: (cause) => new Error("Failed to close the local service control channel", { cause }),
  }).pipe(Effect.ignore)
}
