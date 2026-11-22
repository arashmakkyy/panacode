import { expect, spyOn, test } from "bun:test"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, realpathSync } from "node:fs"
import { copyFile, link, mkdir, readFile, readdir, rmdir, symlink, writeFile } from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import { binaryPath } from "@opencode/pty"
import { Effect, Fiber, type Scope } from "effect"
import {
  createDaemonRuntime,
  matchesUnixDaemonSocket,
  readPtyRegistration,
  removeEmptySpawnParent,
  runtimeDirectory,
} from "../src/persistent-pty/runtime-path"
import { resolve as resolveBun } from "../src/persistent-pty/binary.bun"
import { makeDaemonTransport, type DaemonTransport } from "../src/persistent-pty/daemon"
import {
  fakeDaemon,
  frame,
  fixtureInstance,
  fixtureSocket,
  listen,
  pong,
  temporaryDirectory,
  terminal,
  writeRegistration,
} from "./fixture/persistent-pty-daemon"
import { it } from "./lib/effect"

it.live("rediscovers a same-protocol daemon after its registration rotates", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
    const sockets = [...new Set(["1", "2", "3"].map((n) => fixtureSocket(directory, fixtureInstance(directory, n))))]
    let token = "old-token"
    let instance = fixtureInstance(directory, "1")
    let creates = 0
    for (const endpoint of sockets)
      yield* listen(endpoint, (_socket, request, receivedToken) => {
        if (receivedToken !== token) return { type: "error", message: "authentication failed" }
        if (request.op === "ping") return pong(directory, instance)
        if (request.op === "create") creates++
        return request.op === "list" ? { type: "processes", processes: [] } : { type: "ok" }
      })
    yield* Effect.promise(() => writeRegistration(directory, fixtureSocket(directory, instance), instance, token))
    const daemon = yield* makeDaemonTransport(root, "daemon")
    yield* daemon.request({ op: "list" })

    token = "new-token"
    instance = fixtureInstance(directory, "2")
    yield* Effect.promise(() => writeRegistration(directory, fixtureSocket(directory, instance), instance, token))

    const running = yield* daemon.requestIfRunning({ op: "list" })
    expect(running).toEqual({ type: "processes", processes: [] })

    token = "newest-token"
    instance = fixtureInstance(directory, "3")
    yield* Effect.promise(() => writeRegistration(directory, fixtureSocket(directory, instance), instance, token))
    yield* daemon.request({ op: "create" }, true)
    expect(creates).toBe(1)
  }),
)

it.live("rediscovers a rotated registration when acquiring a subscription", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
    const sockets = [...new Set(["1", "2", "3"].map((n) => fixtureSocket(directory, fixtureInstance(directory, n))))]
    let token = "old-token"
    let instance = fixtureInstance(directory, "1")
    let subscriptions = 0
    for (const endpoint of sockets)
      yield* listen(endpoint, (_socket, request, receivedToken) => {
        if (receivedToken !== token) return { type: "error", message: "authentication failed" }
        if (request.op === "ping") return pong(directory, instance)
        if (request.op !== "subscribe") return { type: "processes", processes: [] }
        subscriptions++
        return {
          type: "attached",
          process: terminal(1),
          role: "observer",
          generation: 1,
          requested_offset: 0,
          available_offset: 0,
          end_offset: 0,
          truncated: false,
          replay_base64: "",
        }
      })
    yield* Effect.promise(() => writeRegistration(directory, fixtureSocket(directory, instance), instance, token))
    const daemon = yield* makeDaemonTransport(root, "daemon")
    yield* daemon.request({ op: "list" })

    token = "new-token"
    instance = fixtureInstance(directory, "2")
    yield* Effect.promise(() => writeRegistration(directory, fixtureSocket(directory, instance), instance, token))

    const attachment = yield* daemon.subscribe(1, {
      cursor: 0,
      attachmentID: "attachment",
      role: "observer",
      onEvent: () => {},
      onEnd: () => {},
    })
    expect(attachment.terminal.id).toBe(1)
    expect(subscriptions).toBe(1)
    attachment.detach()
  }),
)

it.live("waits on its own connection until the process exits", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
    const socketPath = fixtureSocket(directory)
    const waiting: net.Socket[] = []
    yield* listen(socketPath, (socket, request) => {
      if (request.op === "ping") return pong(directory)
      if (request.op === "wait" && request.id === 1) {
        waiting.push(socket)
        return undefined
      }
      return { type: "error", message: "terminal 2 not found" }
    })
    yield* Effect.promise(() => writeRegistration(directory, socketPath))
    const daemon = yield* makeDaemonTransport(root, "daemon")

    const missing = yield* Effect.flip(daemon.wait(2))
    expect(missing).toMatchObject({ kind: "request", message: "terminal 2 not found" })

    const fiber = yield* daemon.wait(1).pipe(Effect.forkScoped({ startImmediately: true }))
    yield* poll(() => waiting.length === 1)
    waiting[0].end(
      frame({ type: "exited", exit_code: null, signal: "SIGTERM", final_offset: 3, output_lines: 1, exited_at: 7 }),
    )
    expect(yield* Fiber.join(fiber)).toEqual({
      type: "exited",
      exit_code: null,
      signal: "SIGTERM",
      final_offset: 3,
      output_lines: 1,
      exited_at: 7,
    })
  }),
)

it.live("closes the wait connection when the wait is interrupted", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
    const socketPath = fixtureSocket(directory)
    const waiting: net.Socket[] = []
    yield* listen(socketPath, (socket, request) => {
      if (request.op === "ping") return pong(directory)
      waiting.push(socket)
      return undefined
    })
    yield* Effect.promise(() => writeRegistration(directory, socketPath))
    const daemon = yield* makeDaemonTransport(root, "daemon")

    const fiber = yield* daemon.wait(1).pipe(Effect.forkScoped({ startImmediately: true }))
    yield* poll(() => waiting.length === 1)
    const closed = new Promise<void>((resolve) => waiting[0].once("close", () => resolve()))
    yield* Fiber.interrupt(fiber)
    yield* Effect.promise(() => closed)
  }),
)

it.live("reports a daemon that goes away during a wait as unreachable", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
    const socketPath = fixtureSocket(directory)
    yield* listen(socketPath, (socket, request) => {
      if (request.op === "ping") return pong(directory)
      socket.destroy()
      return undefined
    })
    yield* Effect.promise(() => writeRegistration(directory, socketPath))
    const daemon = yield* makeDaemonTransport(root, "daemon")

    expect((yield* Effect.flip(daemon.wait(1))).kind).toBe("connect")
  }),
)

it.live("retries a start-required request when connection fails before dispatch", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
    const firstSocket = fixtureSocket(directory)
    const replacement = fixtureInstance(directory, "replacement")
    const secondSocket = fixtureSocket(directory, replacement)
    const first = yield* listen(firstSocket, (_socket, request) => {
      if (request.op === "ping") return pong(directory)
      return { type: "processes", processes: [] }
    })
    yield* Effect.promise(() => writeRegistration(directory, firstSocket))
    const daemon = yield* makeDaemonTransport(root, "daemon")
    yield* daemon.request({ op: "list" })
    yield* Effect.promise(first.close)

    let creates = 0
    yield* listen(secondSocket, (_socket, request) => {
      if (request.op === "ping") return pong(directory, replacement)
      creates++
      return { type: "ok" }
    })
    yield* Effect.promise(() => writeRegistration(directory, secondSocket, replacement))
    yield* daemon.request({ op: "create" }, true)
    expect(creates).toBe(1)
  }),
)

it.live("does not replay a dispatched mutating request when its response is lost", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
    const socketPath = fixtureSocket(directory)
    let creates = 0
    yield* listen(socketPath, (socket, request) => {
      if (request.op === "ping") return pong(directory)
      creates++
      socket.destroy()
      return undefined
    })
    yield* Effect.promise(() => writeRegistration(directory, socketPath))
    const daemon = yield* makeDaemonTransport(root, "daemon")
    const error = yield* Effect.flip(daemon.request({ op: "create" }, true))

    expect(error.kind).toBe("response")
    expect(creates).toBe(1)
  }),
)

it.live("rejects incompatible daemons without replacing or killing them", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
    const existing = yield* Effect.acquireRelease(
      Effect.sync(() => spawn("sleep", ["30"])),
      (child) =>
        Effect.promise(async () => {
          if (child.exitCode !== null || child.signalCode !== null) return
          const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
          child.kill("SIGKILL")
          await exited
        }),
    )
    if (existing.pid === undefined) throw new Error("Expected fixture process PID")
    yield* Effect.promise(() =>
      writeFile(
        path.join(directory, "service.json"),
        JSON.stringify({
          instance_id: "old",
          pid: existing.pid,
          protocol: 7,
          socket: "/unused",
          token: "old",
          features: [],
        }),
        { mode: 0o600 },
      ),
    )
    const daemon = yield* makeDaemonTransport(root, "daemon", () => Promise.resolve("/missing/opencode-pty"))

    const optional = yield* Effect.flip(daemon.requestIfRunning({ op: "list" }))
    expect(optional).toMatchObject({
      kind: "protocol",
      message: "opencode-pty protocol mismatch: daemon=7, client=8",
      pid: existing.pid,
    })

    const starting = yield* Effect.flip(daemon.request({ op: "create" }, true))
    expect(starting).toEqual(optional)
    expect(existing.exitCode).toBeNull()
    expect(existing.signalCode).toBeNull()
    expect(process.kill(existing.pid, 0)).toBeTrue()
  }),
)

it.live("starts fresh instead of failing when an inherited registration is gone or expired", () =>
  Effect.gen(function* () {
    const base = yield* temporaryDirectory()
    const legacy = path.join(base, "legacy")
    yield* Effect.promise(() => mkdir(legacy))
    for (const expiresAt of [Date.now() + 60_000, Date.now() - 1]) {
      const daemon = yield* makeDaemonTransport(path.join(base, "root"), "fresh", undefined, {
        directory: legacy,
        instanceID: "test",
        ticket: "ticket",
        expiresAt,
      })
      expect(yield* daemon.handoff).toBeNull()
      expect(yield* daemon.requestIfRunning({ op: "list" })).toBeUndefined()
    }
  }),
)

test("recognizes both native Unix socket generations only for the private runtime that produced the hash", () => {
  const directory = "/srv/panacode-state/pty/previous"
  const native = "opencode-pty-42/c0d99e5e6755cc59abd8ff757e20c526.sock"
  for (const file of ["/tmp/" + native, "/tmp/panacode-pty-42/" + native]) {
    expect(matchesUnixDaemonSocket(directory, file, "/tmp", 42)).toBeTrue()
    expect(matchesUnixDaemonSocket("/srv/other/pty/previous", file, "/tmp", 42)).toBeFalse()
  }
})

it.live("allocates a separate sweep parent per new daemon and keeps legacy runtimes readable", () =>
  Effect.gen(function* () {
    const { root, directory: legacy } = yield* temporaryRuntime()
    const first = createDaemonRuntime(root)
    const second = createDaemonRuntime(root)
    yield* Effect.promise(async () => {
      expect(path.dirname(first)).not.toBe(path.dirname(second))
      expect(path.dirname(first)).not.toBe(root)
      expect(await readdir(path.dirname(first))).toEqual([])
      await mkdir(first, { mode: 0o700 })
      expect(await readdir(path.dirname(second))).toEqual([])
      expect(runtimeDirectory(root, first)).toBe(realpathSync.native(first))
      expect(runtimeDirectory(root, legacy)).toBe(realpathSync.native(legacy))
      expect(() => runtimeDirectory(root, path.dirname(first))).toThrow()
      expect(() => runtimeDirectory(root, path.join(legacy, "daemon"))).toThrow()
      removeEmptySpawnParent(root, first)
      expect(existsSync(first)).toBeTrue()
      await rmdir(first)
      removeEmptySpawnParent(root, first)
      expect(existsSync(path.dirname(first))).toBeFalse()
      expect(existsSync(legacy)).toBeTrue()
      expect(existsSync(path.dirname(second))).toBeTrue()
    })
  }),
)

it.live("abandons a rejected ownership ticket without shutting down the verified daemon", () =>
  Effect.gen(function* () {
    const existing = yield* fakeDaemon()
    const replacement = yield* makeDaemonTransport(existing.options.root, "replacement", undefined, {
      ...existing.options.handoff,
      ticket: "wrong-ticket",
    })
    expect(yield* replacement.handoff).toBeNull()
    expect(existing.ops).toContain("ping")
    expect(existing.ops).not.toContain("shutdown")
  }),
)

it.live("rejects a foreign, redirected or stale handoff before contacting its endpoint", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
    const other = yield* temporaryDirectory()
    const foreign = path.join(other, "foreign")
    const alias = path.join(root, "alias")
    yield* Effect.promise(async () => {
      await mkdir(foreign)
      await writeRegistration(foreign, "foreign-endpoint")
      await writeRegistration(directory, "unbound-endpoint")
      await symlink(foreign, alias, process.platform === "win32" ? "junction" : "dir")
    })
    const transport = spyOn(net, "createConnection")
    try {
      for (const [location, instance] of [
        [foreign, "test"],
        [alias, "test"],
        [directory, "stale"],
        [directory, "test"],
      ]) {
        const daemon = yield* makeDaemonTransport(root, "fresh", undefined, {
          directory: location,
          instanceID: instance,
          expiresAt: Date.now() + 60000,
          ticket: "sensitive-ticket",
        })
        expect(yield* daemon.handoff).toBeNull()
      }
      expect(transport).not.toHaveBeenCalled()
      expect(() => runtimeDirectory(root, path.join(root, ".."))).toThrow()
      const hard = path.join(root, "hard")
      yield* Effect.promise(async () => {
        await mkdir(hard)
        await link(path.join(foreign, "service.json"), path.join(hard, "service.json"))
      })
      yield* Effect.promise(async () => {
        await expect(readPtyRegistration(hard)).rejects.toThrow("Unsafe PTY registration")
      })
    } finally {
      transport.mockRestore()
    }
  }),
)

it.live("leaves a discovered daemon running when its handoff belongs to another instance", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
    const socketPath = fixtureSocket(directory)
    let shutdowns = 0
    yield* listen(socketPath, (_socket, request) => {
      if (request.op === "ping") return pong(directory)
      if (request.op === "shutdown") shutdowns++
      return { type: "ok" }
    })
    yield* Effect.promise(() => writeRegistration(directory, socketPath))
    yield* makeDaemonTransport(root, "fresh", undefined, {
      directory,
      instanceID: "replaced",
      ticket: "ticket",
      expiresAt: Date.now() + 60_000,
    })
    expect(shutdowns).toBe(0)
  }),
)

function poll(ready: () => boolean) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 200 && !ready(); attempt++) yield* Effect.sleep(10)
    expect(ready()).toBeTrue()
  })
}

function temporaryRuntime() {
  return Effect.gen(function* () {
    const root = yield* temporaryDirectory()
    const directory = path.join(root, "daemon")
    yield* Effect.promise(() => mkdir(directory))
    return { root, directory }
  })
}

if (process.platform !== "win32")
  it.live("gives up at once on a daemon binary that speaks another protocol, and never starts it again", () =>
    Effect.gen(function* () {
      const root = yield* temporaryDirectory()
      const runtime = path.join(root, "runtime")
      const spawns = path.join(root, "spawns")
      const binary = path.join(root, "old-opencode-pty")
      // Registers like an older release would, then idles.
      yield* Effect.promise(() =>
        writeFile(
          binary,
          [
            "#!/bin/sh",
            `echo spawn >> ${JSON.stringify(spawns)}`,
            'mkdir -p "$3/$5"',
            "umask 077",
            `printf '{"instance_id":"old","pid":%s,"protocol":7,"socket":"none","token":"t","features":[]}' $$ > "$3/$5/service.json"`,
            "exec sleep 30",
          ].join("\n"),
          { mode: 0o755 },
        ),
      )
      const daemon = yield* makeDaemonTransport(runtime, "daemon", () => Promise.resolve(binary))
      const started = Date.now()
      const first = yield* daemon.request({ op: "list", mode: "pipe" }, true).pipe(Effect.flip)
      expect(first.kind).toBe("protocol")
      const second = yield* daemon.request({ op: "list", mode: "pipe" }, true).pipe(Effect.flip)
      expect(second.kind).toBe("protocol")
      // Well under the 5 s spawn timeout: the daemon was not waited on again.
      expect(Date.now() - started).toBeLessThan(4_000)
      const count = yield* Effect.promise(() => Bun.file(spawns).text())
      expect(count.trim().split("\n")).toHaveLength(1)
    }),
  )

it.live("rejects a bare daemon name instead of letting PATH choose the executable", () =>
  withEnvironment({ PANACODE_PTY_BIN: "opencode-pty" }, () =>
    Effect.gen(function* () {
      const root = yield* temporaryDirectory()
      const trap = path.join(root, "path")
      const marker = path.join(root, "executed")
      yield* Effect.promise(() => mkdir(trap))
      yield* Effect.promise(() =>
        writeFile(
          path.join(trap, process.platform === "win32" ? "opencode-pty.cmd" : "opencode-pty"),
          process.platform === "win32"
            ? `@echo ran > ${JSON.stringify(marker)}\r\n`
            : `#!/bin/sh\necho ran > ${JSON.stringify(marker)}\n`,
          process.platform === "win32" ? {} : { mode: 0o755 },
        ),
      )
      const savedPath = process.env.PATH
      process.env.PATH = `${trap}${path.delimiter}${savedPath ?? ""}`
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (savedPath === undefined) delete process.env.PATH
          else process.env.PATH = savedPath
        }),
      )

      const daemon = yield* makeDaemonTransport(path.join(root, "runtime"), "daemon")
      const error = yield* Effect.flip(daemon.request({ op: "list" }, true))

      expect(existsSync(marker)).toBeFalse()
      expect(error.kind).toBe("spawn")
      expect(error.message).toContain("must be an absolute path")
    }),
  ),
)

const realBinary = binaryPath !== undefined && existsSync(binaryPath) ? binaryPath : undefined
const realTest = realBinary === undefined ? it.live.skip : it.live

realTest(
  "starts its default daemon from the pinned dependency and keeps the terminal across handoff",
  () =>
    withEnvironment({ PANACODE_PTY_BIN: undefined, PANACODE_PTY_BIN_SHA256: undefined }, () =>
      Effect.gen(function* () {
        const root = yield* temporaryDirectory()
        yield* realTerminal(root)
      }),
    ),
  30_000,
)

realTest(
  "runs a packaged asset from its private cache by absolute path and keeps the terminal across handoff",
  () =>
    Effect.gen(function* () {
      const root = yield* temporaryDirectory()
      if (!realBinary) return
      const source = path.join(root, "asset", path.basename(realBinary))
      yield* Effect.promise(() => mkdir(path.dirname(source), { recursive: true }))
      yield* Effect.promise(() => copyFile(realBinary, source))
      const installed = yield* Effect.promise(async () => {
        const sha256 = createHash("sha256")
          .update(await readFile(source))
          .digest("hex")
        return resolveBun(path.join(root, "cache"), { path: source, version: "test", sha256 })
      })

      expect(path.isAbsolute(installed)).toBeTrue()
      expect(installed.startsWith(path.join(root, "cache"))).toBeTrue()
      expect(installed).not.toBe(source)
      yield* realTerminal(root, () => Promise.resolve(installed))
    }),
  30_000,
)

// The default transport resolves its own binary, creates a real terminal, and hands the running
// daemon to a replacement that must see the same session and terminal.
function realTerminal(root: string, binary?: () => Promise<string>) {
  return Effect.gen(function* () {
    const runtime = path.join(root, "runtime")
    const daemon = yield* makeDaemonTransport(runtime, "real", binary)
    const created = yield* daemon.request(
      {
        op: "create_pty",
        program: process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "/bin/sh",
        args: process.platform === "win32" ? ["/k", "echo pty-marker"] : ["-c", "printf pty-marker; exec cat"],
        cwd: root,
        title: "real",
        group_id: "ses_real",
        env: {},
        cols: 80,
        rows: 24,
      },
      true,
    )
    if (created.type !== "created") return yield* Effect.fail(new Error(`unexpected response: ${created.type}`))
    const id = created.process.id
    yield* Effect.addFinalizer(() => daemon.request({ op: "terminate", id }).pipe(Effect.ignore))

    expect(yield* waitForTerminalText(daemon, id, "pty-marker")).toContain("pty-marker")
    const handoff = yield* daemon.handoff
    if (!handoff) return yield* Effect.fail(new Error("expected a handoff ticket"))
    expect(path.dirname(path.dirname(handoff.directory))).toBe(runtime)
    expect(path.basename(handoff.directory)).toBe("daemon")
    const registration = yield* Effect.promise(() => readFile(path.join(handoff.directory, "service.json"), "utf8"))
    const daemonPID = (JSON.parse(registration) as { pid: number }).pid
    const replacement = yield* makeDaemonTransport(runtime, "replacement", undefined, handoff)
    expect(yield* waitForTerminalText(replacement, id, "pty-marker")).toContain("pty-marker")

    const list = yield* replacement.request({ op: "list", mode: "pty" })
    const terminal = list.type === "processes" ? list.processes.find((item) => item.id === id) : undefined
    expect(terminal?.group_id).toBe("ses_real")
    expect(terminal?.lifecycle.status).toBe("running")
    yield* replacement.shutdown
    // Windows locks a running executable, including the cached copy under this test root.
    yield* waitForExit(daemonPID)
  })
}

function waitForExit(pid: number) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!isRunning(pid)) {
        // Windows can hold a file briefly after its process exits.
        yield* Effect.sleep(100)
        return
      }
      yield* Effect.sleep(50)
    }
    return yield* Effect.fail(new Error(`PTY daemon ${pid} did not exit`))
  })
}

function isRunning(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function waitForTerminalText(daemon: DaemonTransport, id: number, text: string) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt++) {
      const snapshot = yield* daemon.request({ op: "snapshot", id })
      if (snapshot.type === "snapshot" && snapshot.text.includes(text)) return snapshot.text
      yield* Effect.sleep(50)
    }
    return yield* Effect.fail(new Error(`terminal ${id} did not show ${text}`))
  })
}

function withEnvironment<A, E>(
  values: Record<string, string | undefined>,
  body: () => Effect.Effect<A, E, Scope.Scope>,
): Effect.Effect<A, E, Scope.Scope> {
  return Effect.suspend(() => {
    const saved = new Map(Object.keys(values).map((name) => [name, process.env[name]]))
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    return body().pipe(
      Effect.ensuring(
        Effect.sync(() => {
          for (const [name, value] of saved) {
            if (value === undefined) delete process.env[name]
            else process.env[name] = value
          }
        }),
      ),
    )
  })
}
