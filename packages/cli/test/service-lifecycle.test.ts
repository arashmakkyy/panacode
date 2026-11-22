import { NodeFileSystem } from "@effect/platform-node"
import { Service } from "@opencode/client/effect/service"
import { deriveServiceProofKey } from "@opencode/schema/service-proof"
import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"
import { isolatedEnv } from "./fixture/environment"

// Real `serve --service` processes driven by the real CLI commands and client. Only behavior that
// needs real processes lives here; the client's lifecycle decisions are covered by fixture tests in
// packages/client/test. Every case ends with exactly one live server, registered and answering on
// the configured port, which a stop removes without leftovers.

const entry = path.join(import.meta.dir, "../src/index.ts")
// These are real detached service processes. Windows is a supported service platform, so the
// suite runs there too; `processes()` observes the fixture through the OS instead of pgrep.
const serviceTest = test

serviceTest("status without a running service prints stopped and private mode prints no credentials", async () => {
  await using home = await serviceHome()
  expect(await cli(home, "service", "status")).toBe("stopped")
  expect(await cli(home, "service", "status", "--connection-json")).toBe("")
}, 30_000)

serviceTest(
  "concurrent CLI and client starts converge on one server",
  async () => {
    await using home = await serviceHome()

    await Promise.all([
      cli(home, "service", "start"),
      cli(home, "service", "start"),
      ...Array.from({ length: 3 }, () => ensure(home, OPENCODE_VERSION)),
    ])

    const info = await settled(home)
    const publicStatus = await cli(home, "service", "status")
    expect(publicStatus === info.url).toBe(true)
    const privateStatus = JSON.parse(await cli(home, "service", "status", "--connection-json"))
    expect(Object.keys(privateStatus).sort()).toEqual(["id", "password", "pid", "product", "proofKey", "url", "version"])
    expect(privateStatus.product).toBe("panacode")
    expect(privateStatus.url).toBe(publicStatus)
    expect(privateStatus.id).toBe(info.id)
    expect(privateStatus.pid).toBe(info.pid)
    expect(privateStatus.version).toBe(info.version)
    expect(typeof info.password === "string" && privateStatus.password === info.password).toBe(true)
    expect(info.control !== undefined && privateStatus.proofKey === deriveServiceProofKey(info.control.token)).toBe(true)
    await stopped(home)
  },
  120_000,
)

serviceTest(
  "racing restarts during concurrent starts leave one new server",
  async () => {
    await using home = await serviceHome()
    await ensure(home)
    const before = await settled(home)

    await Promise.all([
      cli(home, "service", "restart"),
      cli(home, "service", "restart"),
      cli(home, "service", "start"),
      ensure(home),
      ensure(home),
    ])

    const after = await steady(home)
    expect(after.pid).not.toBe(before.pid)
    await exited(before.pid)
    await stopped(home)
  },
  120_000,
)

serviceTest(
  "version-agnostic clients keep an older server until a client requires the new version",
  async () => {
    await using home = await serviceHome()
    const old = Bun.spawn(
      [process.execPath, "--define", 'OPENCODE_VERSION:"2.0.0-old"', home.entry, "serve", "--service"],
      { env: home.env, stdout: "ignore", stderr: "ignore" },
    )
    const before = await settled(home, "2.0.0-old")

    await Promise.all([ensure(home), cli(home, "service", "start")])
    expect((await settled(home, "2.0.0-old")).pid).toBe(before.pid)

    await Promise.all([ensure(home, OPENCODE_VERSION), ensure(home), cli(home, "service", "start")])

    const after = await settled(home)
    expect(after.pid).not.toBe(before.pid)
    await old.exited
    await stopped(home)
  },
  120_000,
)

serviceTest(
  "an old-protocol server survives every client and is never a takeover target",
  async () => {
    await using home = await serviceHome()
    await using old = Bun.spawn(
      [
        process.execPath,
        path.join(import.meta.dir, "fixture/old-protocol-service.ts"),
        home.registration,
        String(home.port),
      ],
      { stdout: "ignore", stderr: "inherit" },
    )
    await until(() => snapshot(home).then((state) => state.info))

    await expect(cli(home, "service", "start")).rejects.toThrow("no verified control channel")
    await expect(ensure(home)).rejects.toThrow("no verified control channel")
    // Protocol compatibility is checked before version, so even a required version must not
    // replace or take over an endpoint whose health contract cannot be verified.
    await expect(ensure(home, OPENCODE_VERSION)).rejects.toThrow("no verified control channel")
    expect(old.exitCode).toBe(null)
    // No contender was spawned, and the old owner still holds the registration and port.
    expect(await servers(home)).toEqual([])
    expect((await snapshot(home)).info?.pid).toBe(old.pid)
  },
  120_000,
)

serviceTest(
  "an unrelated process on the port gets an actionable error, then the service starts",
  async () => {
    await using home = await serviceHome()
    using listener = Bun.serve({ hostname: "127.0.0.1", port: home.port, fetch: () => new Response("unrelated") })

    const conflict = await cli(home, "service", "start").then(
      () => undefined,
      (error: Error) => error.message,
    )
    expect(conflict).toContain(
      `Managed service port ${home.port} on 127.0.0.1 is already in use by ${
        process.platform === "win32" || Bun.which("lsof") ? `PID ${process.pid} (` : "another process"
      }`,
    )
    expect(conflict).toContain("panacode service set port <port>")
    expect(await servers(home)).toEqual([])
    expect(await Bun.file(home.registration).exists()).toBe(false)

    await listener.stop(true)
    await cli(home, "service", "start")
    await settled(home)
    await stopped(home)
  },
  120_000,
)

serviceTest(
  "a damaged registration and then a crash each end with one replacement server",
  async () => {
    await using home = await serviceHome()
    await ensure(home)
    const original = await settled(home)

    // The original server exits once its registration self-check notices the damage. Wait for
    // the port to be released before starting the replacement, so startup is not a race between
    // the old process and the new contender.
    await fs.writeFile(home.registration, "{")
    await exited(original.pid)
    await cli(home, "service", "start")
    const replacement = await settled(home)
    expect(replacement.pid).not.toBe(original.pid)
    await exited(original.pid)

    process.kill(replacement.pid, "SIGKILL")
    await exited(replacement.pid)
    await cli(home, "service", "start")
    const recovered = await steady(home)
    expect(recovered.pid).not.toBe(replacement.pid)
    await stopped(home, 2)
  },
  120_000,
)

serviceTest(
  "a server that fails to boot reports the failure without respawning",
  async () => {
    await using home = await serviceHome({ failBoot: true })

    await expect(cli(home, "service", "start")).rejects.toThrow("Background service failed to start")

    // A slow first boot can let a second startup attempt begin; it loses the port and exits.
    const info = await until(() => snapshot(home).then((state) => state.info))
    await observe(home, (state) => state.servers.length === 1 && state.servers[0] === info.pid)
    await stopped(home)
  },
  120_000,
)

type Home = Awaited<ReturnType<typeof serviceHome>>
type Snapshot = Awaited<ReturnType<typeof snapshot>>

async function serviceHome(options: { readonly failBoot?: boolean } = {}) {
  // Bun resolves symlinks in the entry path, so process command lines carry the real directory.
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-lifecycle-")))
  const port = await availablePort()
  await fs.mkdir(path.join(root, "config"), { recursive: true })
  await fs.writeFile(path.join(root, "config", "service-local.json"), JSON.stringify({ port }))
  // A private regular file passes the ownership check, then SQLite rejects its contents after registration.
  const database = path.join(root, "data", "panacode", "corrupt.db")
  if (options.failBoot) {
    await fs.mkdir(path.dirname(database), { recursive: true })
    await fs.writeFile(database, "not a SQLite database")
  }
  // Servers spawned through this home's entry carry its path, so `servers()` sees only this home.
  const homeEntry = path.join(root, "opencode.ts")
  await fs.writeFile(homeEntry, `import ${JSON.stringify(entry)}\n`)
  const overrides = options.failBoot ? { PANACODE_DB: database } : {}
  const home = {
    root,
    port,
    entry: homeEntry,
    registration: path.join(root, "state", "panacode", "service-local.json"),
    env: Object.fromEntries(
      Object.entries(isolatedEnv(root, overrides)).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    async [Symbol.asyncDispose]() {
      // Only a failed case leaves processes behind: servers, or CLI commands that could still spawn one.
      // Every observation is scoped to this fixture's exact entry path. On Windows the creation time
      // is read again immediately before signalling, so a reused PID is never killed.
      const owned = await processes(homeEntry)
      await terminate(owned, homeEntry)
      await fs.rm(root, { recursive: true, force: true })
    },
  }
  return home
}

async function cli(home: Home, ...args: string[]) {
  const child = Bun.spawn([process.execPath, home.entry, ...args], { env: home.env, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0) throw new Error(`opencode ${args.join(" ")} exited ${code}: ${stderr.trim()}`)
  return stdout.trim()
}

function ensure(home: Home, version?: string) {
  return Effect.runPromise(
    Service.ensure({
      file: home.registration,
      version,
      command: [process.execPath, home.entry, "serve", "--service"],
      env: home.env,
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  )
}

/** One live server, registered and ready with the expected version on the configured port. */
async function settled(home: Home, version = OPENCODE_VERSION) {
  const state = await observe(home, (state) => isSettled(home, state, version))
  if (state.info === undefined) throw new Error("Settled service has no registration")
  return state.info
}

/** Settled, and still the same server after its registration self-check has run. */
async function steady(home: Home) {
  const info = await settled(home)
  await Bun.sleep(5_500)
  const state = await snapshot(home)
  expect({ settled: isSettled(home, state, OPENCODE_VERSION), id: state.info?.id }).toEqual({
    settled: true,
    id: info.id,
  })
  return info
}

function isSettled(home: Home, state: Snapshot, version: string) {
  return (
    state.info !== undefined &&
    state.info.version === version &&
    new URL(state.info.url).port === String(home.port) &&
    state.answer?.pid === state.info.pid &&
    state.servers.length === 1 &&
    state.servers[0] === state.info.pid
  )
}

async function observe(home: Home, accept: (state: Snapshot) => boolean) {
  const deadline = Date.now() + 30_000
  while (true) {
    const state = await snapshot(home)
    if (accept(state)) return state
    if (Date.now() >= deadline) throw new Error(`Service did not settle: ${JSON.stringify(state)}`)
    await Bun.sleep(100)
  }
}

async function until<A>(read: () => Promise<A | undefined>, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (true) {
    const value = await read()
    if (value !== undefined) return value
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition")
    await Bun.sleep(50)
  }
}

/** Stopping leaves no server, no state files, and a free port. */
async function stopped(home: Home, archived = 0) {
  await Effect.runPromise(Service.stop({ file: home.registration }).pipe(Effect.provide(NodeFileSystem.layer)))
  // Allow the OS a moment to reap exited processes; `stop` itself waits for the owner to exit.
  await until(async () => ((await servers(home)).length === 0 ? true : undefined), 2_000).catch(() => undefined)
  expect(await servers(home)).toEqual([])
  const remaining = await fs.readdir(path.dirname(home.registration)).catch(() => [] as string[])
  expect(remaining).toHaveLength(archived)
  expect(remaining.every((name) => /^service-local\.json\.[a-f0-9-]{36}\.stale$/.test(name))).toBe(true)
  const server = Bun.serve({ hostname: "127.0.0.1", port: home.port, fetch: () => new Response() })
  await server.stop(true)
}

async function snapshot(home: Home) {
  const info = await Bun.file(home.registration)
    .json()
    .then(Schema.decodeUnknownPromise(Service.Info))
    .catch(() => undefined)
  const answer =
    info === undefined
      ? undefined
      : await fetch(new URL("/api/info", info.url), {
          headers: Service.headers({
            url: info.url,
            auth:
              info.password === undefined
                ? undefined
                : { type: "basic", username: "opencode", password: info.password },
          }),
          signal: AbortSignal.timeout(1_000),
        })
          // Starting, stopping, and failed servers also report their PID, with a non-200 status.
          .then((response) => (response.ok ? (response.json() as Promise<{ readonly pid?: number }>) : undefined))
          .catch(() => undefined)
  return { info, answer, servers: await servers(home) }
}

/** Every live `serve --service` process started through this home's entry. */
async function servers(home: Home) {
  return (await processes(home.entry))
    .filter((item) => item.commandLine.includes("serve --service"))
    .map((item) => item.pid)
}

type ObservedProcess = {
  readonly pid: number
  /** OS creation time. Windows uses this to tell a reused PID from the original process. */
  readonly created: string
  readonly commandLine: string
}

async function processes(needle: string): Promise<ObservedProcess[]> {
  if (process.platform === "win32") return windowsProcesses(needle)
  // `pgrep` reports only PIDs, but this fixture also needs the command line to tell server
  // processes apart from CLI commands that share the entry path. `ps` reports both in one pass.
  const output = await Bun.$`ps -Awwo pid=,command=`.nothrow().quiet().text()
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (!match || !match[2].includes(needle)) return []
    return [{ pid: Number(match[1]), created: "", commandLine: match[2] }]
  })
}

// `Get-CimInstance` is the Windows API for reading another process's command line. The fixture
// entry path is unique per home; the creation time is carried along so disposal can prove that a
// PID still belongs to the process it observed before terminating it.
async function windowsProcesses(needle: string) {
  const rows = await windowsRows([
    '$ErrorActionPreference = "Stop"',
    "Get-CimInstance Win32_Process |",
    "  Select-Object ProcessId, @{Name='Created';Expression={\"$($_.CreationDate.Ticks)\"}}, CommandLine |",
    "  ConvertTo-Json -Compress",
  ])
  return rows.flatMap((row) =>
    typeof row.ProcessId === "number" && typeof row.CommandLine === "string" && row.CommandLine.includes(needle)
      ? [{ pid: row.ProcessId, created: row.Created ?? "", commandLine: row.CommandLine }]
      : [],
  )
}

type WindowsRow = { ProcessId?: number; Created?: string; CommandLine?: string }

async function windowsRows(script: ReadonlyArray<string>): Promise<WindowsRow[]> {
  const child = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script.join("\n")], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`Win32_Process query exited ${code}: ${stderr.trim()}`)
  if (stdout.trim() === "") return []
  const parsed = JSON.parse(stdout) as WindowsRow | WindowsRow[]
  return Array.isArray(parsed) ? parsed : [parsed]
}

/** Signal the exact processes this fixture observed, re-checking the Windows creation time first. */
async function terminate(owned: ReadonlyArray<ObservedProcess>, needle: string) {
  for (const item of owned) {
    if (!(await stillOwned(item, needle))) continue
    signal(item.pid, "SIGKILL")
    await exited(item.pid).catch(() => undefined)
  }
}

async function stillOwned(item: ObservedProcess, needle: string) {
  if (process.platform !== "win32") return signal(item.pid, 0)
  const rows = await windowsRows([
    '$ErrorActionPreference = "Stop"',
    `Get-CimInstance Win32_Process -Filter "ProcessId = ${item.pid}" |`,
    "  Select-Object ProcessId, @{Name='Created';Expression={\"$($_.CreationDate.Ticks)\"}}, CommandLine |",
    "  ConvertTo-Json -Compress",
  ])
  const row = rows.find((candidate) => candidate.ProcessId === item.pid)
  return row !== undefined && row.Created === item.created && row.CommandLine?.includes(needle) === true
}

async function exited(pid: number) {
  const deadline = Date.now() + 10_000
  while (signal(pid, 0)) {
    if (Date.now() >= deadline) throw new Error(`Process ${pid} did not exit`)
    await Bun.sleep(25)
  }
}

function signal(pid: number, value: NodeJS.Signals | 0) {
  try {
    process.kill(pid, value)
    return true
  } catch {
    return false
  }
}

async function availablePort() {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = server.port
  await server.stop(true)
  if (port === undefined) throw new Error("Server did not bind a port")
  return port
}
