import { NodeFileSystem } from "@effect/platform-node"
import { validateRoutes } from "@opentunnel/client/effect"
import { Service, type Info } from "@opencode/client/effect/service"
import { registrationSnapshot } from "@opencode/client/service"
import { Global } from "@opencode/util/global"
import { OPENCODE_VERSION } from "../src/version"
import { healthProof, testControl } from "../../client/test/fixture/control"
import { serviceProofPath } from "@opencode/schema/service-proof"
import { expect, test } from "bun:test"
import { Deferred, Effect, FileSystem, Schedule, Schema } from "effect"
import { NetAddress } from "effect/net"
import { TestClock } from "effect/testing"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { PortOwner } from "../src/services/port-owner"
import { ServiceConfig } from "../src/services/service-config"
import { ServiceRegistration } from "../src/services/service-registration"
import { isolatedEnv, transpilerCache } from "./fixture/environment"
import { testEffect } from "../../core/test/lib/effect"

const it = testEffect(NodeFileSystem.layer)

test("managed service ports are stable per installation channel", () => {
  expect(ServiceConfig.defaultPort("latest", "linux")).toBe(0xc0ac)
  expect(ServiceConfig.defaultPort("dev", "linux")).toBe(0xc0ac)
  expect(ServiceConfig.defaultPort("beta", "linux")).toBe(0xc0ac)
  expect(ServiceConfig.defaultPort("next", "linux")).toBe(0xc0ac)
  expect(ServiceConfig.defaultPort("local", "linux")).toBe(0xc0ad)
  expect(ServiceConfig.defaultPort("latest", "darwin")).toBe(0xc0ac)
  expect(ServiceConfig.defaultPort("preview-a", "linux")).toBe(ServiceConfig.defaultPort("preview-a", "linux"))
  expect(ServiceConfig.defaultPort("preview-a", "linux")).not.toBe(ServiceConfig.defaultPort("preview-b", "linux"))
})

test("prod CLIs, as built by the panacode-windows workflow, register where Desktop looks", () => {
  // Desktop polls service.json (packages/desktop/src/main/service/cli-service-file.ts). A prod CLI that registered in
  // service-prod.json left every packaged Windows launch waiting until the startup timeout.
  expect(ServiceConfig.releaseChannel("prod")).toBe(true)
  expect(ServiceConfig.filename("prod")).toBe("service.json")
  expect(ServiceConfig.filename("latest")).toBe("service.json")
  expect(ServiceConfig.filename("preview-a")).toBe("service-preview-a.json")
  expect(ServiceConfig.defaultPort("prod", "win32")).toBe(0x70ac)
  expect(ServiceConfig.defaultPort("prod", "linux")).toBe(0xc0ac)
})

test("managed service ports on Windows stay below the ranges Windows and WSL reserve", () => {
  expect(ServiceConfig.defaultPort("latest", "win32")).toBe(0x70ac)
  expect(ServiceConfig.defaultPort("dev", "win32")).toBe(0x70ac)
  expect(ServiceConfig.defaultPort("local", "win32")).toBe(0x70ad)
  const ports = Array.from({ length: 200 }, (_, index) => ({
    windows: ServiceConfig.defaultPort(`preview-${index}`, "win32"),
    linux: ServiceConfig.defaultPort(`preview-${index}`, "linux"),
  }))
  expect(ports.some((port) => port.linux >= 0x8000)).toBe(true)
  expect(ports.every((port) => port.windows >= 10_000 && port.windows < 0x8000)).toBe(true)
  expect(ports.filter((port) => port.linux < 0x8000 && port.windows !== port.linux)).toEqual([])
})

test("Panacode's managed service port never matches upstream OpenCode's", () => {
  // OpenCode listens on 0xC0DE (49374) and 0x70DE (28894) on Windows; sharing either made Panacode fail to start
  // while OpenCode was open.
  for (const platform of ["linux", "darwin", "win32"] as const)
    for (const channel of ["latest", "prod", "dev", "beta", "next", "local"]) {
      const port = ServiceConfig.defaultPort(channel, platform)
      expect([0xc0de, 0xc0df, 0x70de, 0x70df, 0x0c0c]).not.toContain(port)
    }
  const windows = ServiceConfig.defaultPort("latest", "win32")
  expect(windows).toBe(28844)
  // Outside the WSL mirrored block and the Windows dynamic range.
  expect(windows < 44620 || windows > 48715).toBe(true)
  expect(windows).toBeLessThan(0xc000)
})

test("service disabled accepts only booleans without changing configuration on invalid input", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-disabled-config-"))
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const run = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer)))
  try {
    expect(await run(ServiceConfig.get("disabled"))).toBe("false")
    await expect(run(ServiceConfig.set("disabled", "yes"))).rejects.toThrow("Disabled must be true or false")
    expect(await run(ServiceConfig.read())).toEqual({})
    await run(ServiceConfig.set("disabled", "true"))
    expect(await run(ServiceConfig.read())).toEqual({ disabled: true })
    await run(ServiceConfig.unset("disabled"))
    expect(await run(ServiceConfig.read())).toEqual({})
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

// Enabling remote creates a real tunnel, so only the paths that stay local are covered here.
test("service remote accepts only booleans and persists across set and unset", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-remote-config-"))
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const run = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer)))
  try {
    expect(await run(ServiceConfig.get("remote"))).toBe("false")
    await expect(run(ServiceConfig.set("remote", "on"))).rejects.toThrow("Remote must be true or false")
    expect(await run(ServiceConfig.read())).toEqual({})
    await run(ServiceConfig.set("remote", "false"))
    expect(await run(ServiceConfig.read())).toEqual({})
    expect(await run(ServiceConfig.get("remote"))).toBe("false")
    await run(ServiceConfig.unset("remote"))
    expect(await run(ServiceConfig.read())).toEqual({})
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("remote access route is random, stable once created, hidden, and forgotten when remote is turned off", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-remote-route-"))
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const run = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer)))
  try {
    const route = await run(ServiceConfig.remote())
    // The SDK rejects invalid route names, which would keep the service from ever attaching.
    expect(() => validateRoutes({ [route]: "127.0.0.1:4096" })).not.toThrow()
    expect(route).toMatch(/^[0-9a-f]{16}$/)
    expect(await run(ServiceConfig.read())).toEqual({ remote: { route } })
    expect(await run(ServiceConfig.remote())).toBe(route)
    expect(await run(ServiceConfig.get("remote"))).toBe("true")
    expect(await run(ServiceConfig.get())).not.toContain(route)

    await run(ServiceConfig.set("remote", "false"))
    expect(await run(ServiceConfig.read())).toEqual({ remoteAccepted: true })
    expect(await run(ServiceConfig.get("remote"))).toBe("false")
    expect(await run(ServiceConfig.remote())).not.toBe(route)

    await run(ServiceConfig.unset("remote"))
    expect(await run(ServiceConfig.read())).toEqual({ remoteAccepted: true })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("reading a config with remote access stored as a boolean repairs it in place and keeps other settings", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-remote-legacy-"))
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const run = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer)))
  const file = path.join(root, "config", ServiceConfig.filename())
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })

    await Bun.write(file, JSON.stringify({ remote: true, password: "kept", env: { A: "1" } }))
    const enabled = await run(ServiceConfig.read())
    const route = enabled.remote?.route ?? ""
    expect(route).toMatch(/^[0-9a-f]{16}$/)
    expect(enabled).toEqual({ remote: { route }, password: "kept", env: { A: "1" } })
    expect(await Bun.file(file).json()).toEqual(enabled)
    expect(await run(ServiceConfig.read())).toEqual(enabled)

    await Bun.write(file, JSON.stringify({ remote: false, password: "kept" }))
    expect(await run(ServiceConfig.read())).toEqual({ password: "kept" })
    expect(await Bun.file(file).json()).toEqual({ password: "kept" })

    const current = JSON.stringify({ remote: { route: "0123456789abcdef" }, password: "kept" })
    await Bun.write(file, current)
    expect(await run(ServiceConfig.read())).toEqual({ remote: { route: "0123456789abcdef" }, password: "kept" })
    expect(await Bun.file(file).text()).toBe(current)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("local channel stores service config with the local service filename", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-"))
  try {
    await Effect.runPromise(
      ServiceConfig.set("hostname", "127.0.0.2").pipe(
        Effect.provide(Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(await Bun.file(path.join(root, "config", "service-local.json")).json()).toEqual({
      hostname: "127.0.0.2",
    })
    expect(await Bun.file(path.join(root, "config", "service.json")).exists()).toBe(false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("service config manages environment variables", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-env-"))
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  try {
    await Effect.runPromise(
      ServiceConfig.set("env", "PANACODE_SERVICE_ENV_TEST", "configured").pipe(
        Effect.provide(layer),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(
      await Effect.runPromise(
        ServiceConfig.get("env", "PANACODE_SERVICE_ENV_TEST").pipe(
          Effect.provide(layer),
          Effect.provide(NodeFileSystem.layer),
        ),
      ),
    ).toBe("configured")
    expect(
      (
        await Effect.runPromise(
          ServiceConfig.options().pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer)),
        )
      ).env,
    ).toEqual({ PANACODE_SERVICE_ENV_TEST: "configured" })

    await Effect.runPromise(
      ServiceConfig.unset("env", "PANACODE_SERVICE_ENV_TEST").pipe(
        Effect.provide(layer),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(await Bun.file(path.join(root, "config", "service-local.json")).json()).toEqual({})
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("saved service environment cannot move the registration's state directory", async () => {
  expect(ServiceConfig.processEnv(undefined)).toBeUndefined()
  expect(ServiceConfig.processEnv({ XDG_STATE_HOME: "/custom/state", XDG_DATA_HOME: "/custom/data", A: "1" })).toEqual({
    XDG_DATA_HOME: "/custom/data",
    A: "1",
  })

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-env-state-"))
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  try {
    await fs.mkdir(path.join(root, "config"), { recursive: true })
    await Bun.write(
      path.join(root, "config", ServiceConfig.filename()),
      JSON.stringify({
        env: {
          xdg_state_home: path.join(root, "elsewhere"),
          Panacode_Service_Proof_Key: "persisted",
          panacode_pty_handoff: "persisted",
          A: "1",
        },
      }),
    )
    const options = await Effect.runPromise(
      ServiceConfig.options().pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer)),
    )
    expect(options.env).toEqual({ A: "1" })
    expect(options.file).toBe(path.join(root, "state", ServiceConfig.filename()))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("port owner reads Windows netstat and tasklist output", () => {
  const netstat = [
    "",
    "Active Connections",
    "",
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1100",
    "  TCP    127.0.0.1:28894        0.0.0.0:0              ABHÖREN         4242",
    "  TCP    127.0.0.1:28894        127.0.0.1:50123        ESTABLISHED     4242",
    "  TCP    127.0.0.1:50123        127.0.0.1:28894        ESTABLISHED     9999",
    "  TCP    [::]:28844             [::]:0                 LISTENING       5151",
  ].join("\r\n")
  expect(PortOwner.windowsListeners(netstat, 28894)).toEqual([{ pid: "4242", address: "127.0.0.1" }])
  expect(PortOwner.windowsListeners(netstat, 28844)).toEqual([{ pid: "5151", address: "::" }])
  expect(PortOwner.windowsListeners(netstat, 1)).toEqual([])
  expect(PortOwner.windowsImageName('"opencode-cli.exe","4242","Console","1","81,234 K"\r\n')).toBe("opencode-cli.exe")
  expect(PortOwner.windowsImageName("INFO: No tasks are running which match the specified criteria.")).toBeUndefined()
})

test.skipIf(process.platform === "win32" || !Bun.which("lsof"))("port owner names the listening process", async () => {
  using listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  using wildcard = Bun.serve({ hostname: "0.0.0.0", port: 0, fetch: () => new Response() })
  const describe = (port: number | undefined, hostname?: string) =>
    Effect.runPromise(PortOwner.describe(port ?? 0, hostname).pipe(Effect.provide(LayerNode.compile(AppProcess.node))))
  expect(await describe(listener.port)).toStartWith(`PID ${process.pid} (`)
  expect(await describe(listener.port, "127.0.0.1")).toStartWith(`PID ${process.pid} (`)
  expect(await describe(listener.port, "localhost")).toStartWith(`PID ${process.pid} (`)
  expect(await describe(listener.port, "127.0.0.2")).toBeUndefined()
  expect(await describe(wildcard.port, "127.0.0.2")).toStartWith(`PID ${process.pid} (`)
})

test.skipIf(process.platform === "win32")("port owner gives up on a lookup that ignores SIGTERM", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-port-owner-stuck-"))
  const PATH = process.env.PATH
  try {
    await Bun.write(path.join(root, "lsof"), "#!/bin/sh\ntrap '' TERM\nsleep 10\n")
    await fs.chmod(path.join(root, "lsof"), 0o755)
    process.env.PATH = `${root}${path.delimiter}${PATH}`
    const started = Date.now()
    const owner = await Promise.race([
      Effect.runPromise(PortOwner.describe(1).pipe(Effect.provide(LayerNode.compile(AppProcess.node)))),
      Bun.sleep(4_000).then(() => "hung"),
    ])
    expect(owner).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(3_000)
  } finally {
    process.env.PATH = PATH
    await fs.rm(root, { recursive: true, force: true })
  }
})

test.skipIf(process.platform === "win32")("port owner is unknown for a free port", async () => {
  const free = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = free.port ?? 0
  free.stop(true)
  expect(
    await Effect.runPromise(PortOwner.describe(port).pipe(Effect.provide(LayerNode.compile(AppProcess.node)))),
  ).toBeUndefined()
})

test("service filenames share release channels and identify preview channels", () => {
  expect(ServiceConfig.filename("latest")).toBe("service.json")
  expect(ServiceConfig.filename("dev")).toBe("service.json")
  expect(ServiceConfig.filename("beta")).toBe("service.json")
  expect(ServiceConfig.filename("next")).toBe("service.json")
  expect(ServiceConfig.filename("local")).toBe("service-local.json")
  expect(ServiceConfig.filename("preview-a")).toBe("service-preview-a.json")
  expect(ServiceConfig.filename("preview/a")).toBe("service-preview-a.json")
  expect(ServiceConfig.versionBelongsToChannel("0.0.0-preview-a-1234", "preview-a")).toBe(true)
  expect(ServiceConfig.versionBelongsToChannel("0.0.0-preview-a-1234.2", "preview-a")).toBe(true)
  expect(ServiceConfig.versionBelongsToChannel("0.0.0-preview-a-other-1234", "preview-a")).toBe(false)
  expect(ServiceConfig.versionBelongsToChannel("1.2.3", "preview-a")).toBe(false)
})

test("service config migrates from the hashed channel filename", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-config-migration-"))
  const legacy = path.join(root, ServiceConfig.legacyFilename("preview-a")!)
  const target = path.join(root, ServiceConfig.filename("preview-a"))
  try {
    await fs.writeFile(legacy, JSON.stringify({ hostname: "127.0.0.2", port: 4098 }))
    await Effect.runPromise(ServiceConfig.migrateConfig(legacy, target).pipe(Effect.provide(NodeFileSystem.layer)))
    expect(await Bun.file(target).json()).toEqual({ hostname: "127.0.0.2", port: 4098 })

    await fs.writeFile(target, JSON.stringify({ port: 4099 }))
    await Effect.runPromise(ServiceConfig.migrateConfig(legacy, target).pipe(Effect.provide(NodeFileSystem.layer)))
    expect(await Bun.file(target).json()).toEqual({ port: 4099 })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("r10 production config migrates once ahead of stale hashed settings, without mutating the original", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-r10-config-"))
  const legacy = path.join(root, "service-prod.json")
  const target = path.join(root, "service.json")
  const text = JSON.stringify({ port: 28844, password: "r10-private" })
  const migrate = (channel: string) =>
    Effect.runPromise(ServiceConfig.migrateChannelConfig(root, channel).pipe(Effect.provide(NodeFileSystem.layer)))
  try {
    await fs.writeFile(legacy, text)
    await fs.writeFile(path.join(root, ServiceConfig.legacyFilename("prod")!), '{"password":"older"}')
    await migrate("latest")
    expect(await Bun.file(target).exists()).toBe(false)
    await Promise.all([migrate("prod"), migrate("prod")])
    expect(await fs.readFile(target, "utf8")).toBe(text)
    expect(await fs.readFile(legacy, "utf8")).toBe(text)
    await fs.writeFile(target, '{"password":"current"}')
    await migrate("prod")
    expect(await Bun.file(target).json()).toEqual({ password: "current" })
    expect(await fs.readFile(legacy, "utf8")).toBe(text)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("collocated state and config separate unambiguous settings without treating a registration as config", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-shared-xdg-"))
  const state = path.join(root, "shared")
  const config = path.join(root, "alias")
  const name = ServiceConfig.filename()
  const file = path.join(state, name)
  const separated = path.join(state, "settings." + name)
  const layer = Global.layerWith({ config, state })
  const read = () => Effect.runPromise(ServiceConfig.read().pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer)))
  try {
    await fs.mkdir(state)
    await fs.symlink(state, config, process.platform === "win32" ? "junction" : "dir")
    const oldConfig = '{"port":4321,"password":"original-settings","remoteAccepted":true}'
    await fs.writeFile(file, oldConfig)
    expect(await Promise.all([read(), read()])).toEqual([JSON.parse(oldConfig), JSON.parse(oldConfig)])
    const archive = (await fs.readdir(state)).find((entry) => entry.endsWith(".legacy-config"))
    expect(await fs.readFile(path.join(state, archive!), "utf8")).toBe(oldConfig)
    expect(await Bun.file(file).exists()).toBe(false)
    const registered = JSON.stringify({ id: "running", product: "panacode", version: "2", pid: process.pid, url: "http://127.0.0.1:28844", password: "service-only" })
    await fs.writeFile(file, registered)
    expect(await read()).toEqual(JSON.parse(oldConfig))
    await fs.rm(separated)
    expect(await read()).toEqual({})
    expect(await fs.readFile(file, "utf8")).toBe(registered)
    const mixed = '{"pid":123,"port":5555,"password":"ambiguous"}'
    await fs.writeFile(file, mixed)
    await expect(read()).rejects.toThrow("ambiguous service record")
    expect(await fs.readFile(file, "utf8")).toBe(mixed)
    expect(await Bun.file(separated).exists()).toBe(false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("service settings refuse linked credentials and leave the external file untouched", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-linked-settings-"))
  const directory = path.join(root, "config")
  const layer = Global.layerWith({ config: directory, state: path.join(root, "state") })
  const read = () => Effect.runPromise(ServiceConfig.read().pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer)))
  try {
    await fs.mkdir(directory)
    const foreign = path.join(root, "external.json")
    const file = path.join(directory, ServiceConfig.filename())
    const secret = '{"password":"foreign"}'
    await fs.writeFile(foreign, secret)
    await fs.link(foreign, file)
    await expect(read()).rejects.toThrow()
    await fs.unlink(file)
    if (process.platform !== "win32") {
      await fs.symlink(foreign, file)
      await expect(read()).rejects.toThrow()
    }
    expect(await fs.readFile(foreign, "utf8")).toBe(secret)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("registration migration requires Panacode ownership and never moves stable discovery", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-migration-"))
  const legacy = path.join(root, "service.json")
  const target = path.join(root, ServiceConfig.filename("preview-a"))
  const owned = {
    id: "old-preview",
    product: "panacode",
    version: "0.0.0-preview-a-1234",
    url: "http://127.0.0.1:4096",
    pid: 1,
    password: "preview-secret",
  }
  const write = (value: unknown) => fs.writeFile(legacy, JSON.stringify(value))
  const migrate = () =>
    Effect.runPromise(
      ServiceConfig.migrateRegistration(legacy, target, "preview-a", "0.0.0-preview-a-5678").pipe(
        Effect.provide(NodeFileSystem.layer),
      ),
    )
  try {
    await write(owned)
    await migrate()
    expect(await Bun.file(legacy).exists()).toBe(true)
    expect(await Bun.file(target).exists()).toBe(false)
    const live = { ...owned, pid: process.pid, product: "panacode" as const }
    await using channel = await testControl(() => live)
    await write({ ...live, control: channel.control })
    await migrate()
    expect(await Bun.file(target).json()).toMatchObject({ id: live.id, control: channel.control })
    await fs.rm(target)

    await write({ ...owned, version: "1.2.3" })
    await migrate()
    expect(await Bun.file(target).exists()).toBe(false)

    await write({ ...owned, product: undefined })
    await migrate()
    expect(await Bun.file(target).exists()).toBe(false)

    await write({ ...owned, product: "opencode" })
    await migrate()
    expect(await Bun.file(target).exists()).toBe(false)

    await write({ ...owned, id: undefined })
    await migrate()
    expect(await Bun.file(target).exists()).toBe(false)

    await write({ ...owned, password: undefined })
    await migrate()
    expect(await Bun.file(target).exists()).toBe(false)

    await write(owned)
    await fs.writeFile(target, JSON.stringify({ id: "current-preview" }))
    await migrate()
    expect(await Bun.file(legacy).exists()).toBe(true)
    expect(await Bun.file(target).json()).toMatchObject({ id: "current-preview" })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

it.effect("deleting a managed service registration stops its owner", () =>
  Effect.gen(function* () {
    const service = yield* registered()
    yield* service.fileSystem.remove(service.file)
    yield* service.stops
    yield* service.cleanup
    expect(yield* service.fileSystem.exists(service.file)).toBe(false)
  }),
)

it.effect("corrupting a managed service registration stops its owner", () =>
  Effect.gen(function* () {
    const service = yield* registered()
    yield* service.fileSystem.writeFileString(service.file, "not-json")
    yield* service.stops
    yield* service.cleanup
    expect(yield* service.fileSystem.readFileString(service.file)).toBe("not-json")
  }),
)

it.effect("replacing a managed service registration stops its owner and preserves the foreign owner", () =>
  Effect.gen(function* () {
    const service = yield* registered()
    const foreign = JSON.stringify({ id: "foreign-owner", url: "http://127.0.0.1:4322", pid: process.pid })
    yield* service.fileSystem.writeFileString(service.file, foreign)
    yield* service.stops
    yield* service.cleanup
    expect(yield* service.fileSystem.readFileString(service.file)).toBe(foreign)
  }),
)

it.effect("an owner cleanup leaves a newer Panacode registration in place", () =>
  Effect.gen(function* () {
    const service = yield* registered()
    const newer = JSON.stringify({
      id: "new-owner",
      product: "panacode",
      version: "test",
      url: "http://127.0.0.1:4322",
      pid: process.pid + 1,
      password: "new-secret",
    })
    yield* service.fileSystem.writeFileString(service.file, newer)
    yield* service.cleanup
    expect(yield* service.fileSystem.readFileString(service.file)).toBe(newer)
  }),
)

// Real process: a server whose boot failed must still be watching its registration.
test("deleting a failed service registration stops its owner", async () => {
  const service = await startManagedService("opencode-service-failed-delete-", true)
  try {
    await waitForFailed(service.info)
    await fs.rm(service.registration)
    expect(await waitForExit(service.owner)).toBe(true)
    await expectPortAvailable(service.port)
  } finally {
    await stopManagedService(service)
  }
}, 30_000)

test("clean managed service shutdown removes its registration and a second stop is a no-op", async () => {
  const service = await startManagedService("opencode-service-clean-")
  const stop = () =>
    Effect.runPromise(Service.stop({ file: service.registration }).pipe(Effect.provide(NodeFileSystem.layer)))
  try {
    await stop()
    expect(await waitForExit(service.owner)).toBe(true)
    expect(await Bun.file(service.registration).exists()).toBe(false)
    await stop()
  } finally {
    await stopManagedService(service)
  }
}, 30_000)

test("a restarted managed service publishes a new instance identity and never exposes its secrets", async () => {
  const first = await startManagedService("opencode-service-restart-a-")
  let second: Awaited<ReturnType<typeof startManagedService>> | undefined
  try {
    second = await startManagedService("opencode-service-restart-b-")
    expect(second.info.id).not.toBe(first.info.id)

    const health = await fetch(new URL("/api/info", second.info.url), {
      headers: { authorization: "Basic " + btoa(`opencode:${second.info.password}`) },
      signal: AbortSignal.timeout(5_000),
    }).then((response) => response.json())
    expect(health).toMatchObject({ instance: second.info.id, pid: second.info.pid })
    expect(health).not.toHaveProperty("password")
    expect(health).not.toHaveProperty("control")
    const body = JSON.stringify(health)
    expect(body).not.toContain(second.info.password)
    expect(second.info.control).toBeDefined()
    if (second.info.control === undefined) throw new Error("missing control registration")
    expect(body).not.toContain(second.info.control.token)
  } finally {
    if (second !== undefined) await stopManagedService(second)
    await stopManagedService(first)
  }
}, 60_000)

test("service restart replaces a managed service with a fresh instance", async () => {
  const first = await startManagedService("opencode-service-restart-command-")
  try {
    const restart = Bun.spawn(
      [process.execPath, path.join(import.meta.dir, "../src/index.ts"), "service", "restart"],
      { env: serviceEnv(first.root), stdout: "pipe", stderr: "pipe" },
    )
    const [code, stderr] = await Promise.all([restart.exited, new Response(restart.stderr).text()])
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" })

    const restarted = await waitForInfo(first.registration, (info) => info.id !== first.info.id)
    expect(restarted.pid).not.toBe(first.info.pid)
    expect(new URL(restarted.url).port).toBe(String(first.port))
    expect(await waitForExit(first.owner)).toBe(true)
    await Effect.runPromise(Service.stop({ file: first.registration }).pipe(Effect.provide(NodeFileSystem.layer)))
    expect(await Bun.file(first.registration).exists()).toBe(false)
  } finally {
    const running = await Bun.file(first.registration)
      .json()
      .then((info: { pid?: number }) => info.pid)
      .catch(() => undefined)
    if (running !== undefined) {
      try {
        process.kill(running, "SIGTERM")
      } catch {}
    }
    await stopManagedService(first)
  }
}, 60_000)

test("concurrent service processes elect one server", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-election-"))
  const env = serviceEnv(root)
  const command = [process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"]
  const registration = path.join(root, "state", "panacode", "service-local.json")
  const port = await availablePort()
  const config = path.join(root, "config", "panacode", "service-local.json")
  await fs.mkdir(path.join(root, "config", "panacode"), { recursive: true })
  await fs.writeFile(config, JSON.stringify({ port }))
  const processes = Array.from({ length: 10 }, () => Bun.spawn(command, { env, stderr: "pipe", stdout: "pipe" }))

  try {
    const info = await waitForInfo(registration)
    const winner = processes.find((process) => process.pid === info.pid)
    const losers = processes.filter((process) => process.pid !== info.pid)
    const exited = await Promise.all(
      losers.map((process) => Promise.race([process.exited.then(() => true), Bun.sleep(60_000).then(() => false)])),
    )

    expect(exited).toEqual(losers.map(() => true))
    const errors = await Promise.all(
      losers.map(
        async (process) => (await new Response(process.stdout).text()) + (await new Response(process.stderr).text()),
      ),
    )
    expect(
      losers.map((process) => process.exitCode),
      errors.filter(Boolean).join("\n"),
    ).toEqual(losers.map(() => 0))
    expect(winner?.exitCode).toBe(null)
    expect(new URL(info.url).port).toBe(String(port))
    expect((await Bun.file(config).json()).password).toBe(info.password)
    expect(await Bun.file(registration + ".lock").exists()).toBe(false)
    expect(
      await fetch(new URL("/api/info", info.url), {
        headers: { authorization: "Basic " + btoa(`opencode:${info.password}`) },
      }).then((response) => response.json()),
    ).toMatchObject({
      version: info.version,
      pid: info.pid,
      hostname: os.hostname(),
      urls: [info.url],
      // The server reports the canonical tmp directory; Windows os.tmpdir() can be an 8.3 short name.
      paths: { tmp: await fs.realpath(path.join(os.tmpdir(), "panacode")) },
      capabilities: { persistentPty: true },
    })
    const contender = Bun.spawn(command, { env, stderr: "pipe", stdout: "ignore" })
    try {
      const contenderExited = await Promise.race([
        contender.exited.then(() => true),
        Bun.sleep(10_000).then(() => false),
      ])
      expect(contenderExited).toBe(true)
      expect(contender.exitCode).toBe(0)
      expect((await waitForInfo(registration)).id).toBe(info.id)
    } finally {
      contender.kill("SIGTERM")
      await contender.exited
    }
    await Effect.runPromise(Service.stop({ file: registration }).pipe(Effect.provide(NodeFileSystem.layer)))
    await winner?.exited
    expect(await Bun.file(registration).exists()).toBe(false)
  } finally {
    processes.forEach((process) => process.kill("SIGTERM"))
    await Promise.all(processes.map((process) => process.exited))
    await fs.rm(root, { recursive: true, force: true })
  }
}, 120_000)

test("an occupied channel default still elects exactly one authenticated service", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-default-collision-"))
  // Give this fixture its own channel so a developer's installed service is never a test target.
  const channel = "collision-" + crypto.randomUUID().slice(0, 8)
  const port = ServiceConfig.defaultPort(channel)
  using listener = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("witness") })
  const file = path.join(root, "state", "panacode", ServiceConfig.filename(channel))
  const command = [process.execPath, "--define", `OPENCODE_CHANNEL=${JSON.stringify(channel)}`, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"]
  const contenders = [1, 2].map(() => Bun.spawn(command, { env: isolatedEnv(root), stdout: "ignore", stderr: "pipe" }))
  try {
    const info = await Promise.race([
      waitForInfo(file),
      Promise.all(contenders.map(async (child) => ({ code: await child.exited, error: await new Response(child.stderr).text() }))).then((results) => {
        throw new Error("All contenders exited before publication: " + JSON.stringify(results))
      }),
    ])
    const endpoint = await Effect.runPromise(Service.ensure({ file }).pipe(Effect.provide(NodeFileSystem.layer)))
    expect(endpoint.auth?.password).toBe(info.password)
    expect(new URL(endpoint.url).port).not.toBe(String(port))
    const winner = contenders.find((child) => child.pid === info.pid)
    const loser = contenders.find((child) => child !== winner)
    expect(winner).toBeDefined()
    expect(loser).toBeDefined()
    if (!loser) throw new Error("No losing contender")
    expect(await waitForExit(loser, 20_000)).toBe(true)
    expect(loser.exitCode).toBe(0)
    expect(await Bun.file(path.join(root, "panacode.db")).exists()).toBe(true)
    expect(await fetch(listener.url).then((res) => res.text())).toBe("witness")
    await Effect.runPromise(Service.stop({ file }).pipe(Effect.provide(NodeFileSystem.layer)))
    expect(await fetch(listener.url).then((res) => res.text())).toBe("witness")
  } finally {
    for (const child of contenders) if (child.exitCode === null && child.signalCode === null) child.kill()
    await Promise.all(contenders.map((child) => child.exited))
    await fs.rm(root, { recursive: true, force: true })
  }
}, 60_000)

test("configured managed service port overrides the channel default", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-port-"))
  const port = await availablePort()
  const env = serviceEnv(root)
  const registration = path.join(root, "state", "panacode", "service-local.json")
  const config = path.join(root, "config", "panacode", "service-local.json")
  await fs.mkdir(path.join(root, "config", "panacode"), { recursive: true })
  await fs.writeFile(config, JSON.stringify({ port, password: "" }))
  const owner = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env,
    stderr: "pipe",
    stdout: "ignore",
  })
  try {
    const info = await waitForInfo(registration)
    expect(new URL(info.url).port).toBe(String(port))
    expect(info.password).not.toBe("")
    expect((await Bun.file(config).json()).password).toBe(info.password)
    await Effect.runPromise(Service.stop({ file: registration }).pipe(Effect.provide(NodeFileSystem.layer)))
    await owner.exited
  } finally {
    owner.kill("SIGTERM")
    await owner.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

test.each([
  { args: [], origins: ["http://192.0.2.10:3001", "https://configured.example.com"] },
  {
    args: ["--cors", "http://192.0.2.20:3001", "--cors", "https://override.example.com"],
    origins: ["http://192.0.2.20:3001", "https://override.example.com"],
  },
])(
  "managed service applies CORS configuration with flag overrides: $args",
  async ({ args, origins }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-cors-"))
    const config = path.join(root, "config", ServiceConfig.filename())
    const registration = path.join(root, "state", "panacode", ServiceConfig.filename())
    const cors = ["http://192.0.2.10:3001", "https://configured.example.com"]
    await fs.mkdir(path.dirname(config), { recursive: true })
    await fs.writeFile(config, JSON.stringify({ cors }))
    const owner = Bun.spawn(
      [process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service", "--port", "0", ...args],
      { env: isolatedEnv(root), stderr: "pipe", stdout: "ignore" },
    )
    try {
      const info = await waitForInfo(registration)
      await Promise.all(
        [...new Set([...cors, ...origins, "https://unlisted.example.com"])].map(async (origin) => {
          const response = await fetch(new URL("/api/info", info.url), {
            method: "OPTIONS",
            headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
          })
          expect(response.headers.get("access-control-allow-origin")).toBe(
            origins.some((value) => value === origin) ? origin : null,
          )
        }),
      )
      expect((await Bun.file(config).json()).cors).toEqual(cors)
    } finally {
      owner.kill("SIGTERM")
      await owner.exited
      await fs.rm(root, { recursive: true, force: true })
    }
  },
  30_000,
)

test("the original managed service contender binds when the occupied port is released", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-bind-retry-"))
  const recognizing = Promise.withResolvers<void>()
  const requests: string[] = []
  using listener = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url).pathname)
      if (requests.length === 2) recognizing.resolve()
      return Response.json({ unrelated: true })
    },
  })
  const port = listener.port
  if (port === undefined) throw new Error("Server did not bind a port")
  const registration = path.join(root, "state", "panacode", "service-local.json")
  await fs.mkdir(path.join(root, "config"), { recursive: true })
  await fs.mkdir(path.dirname(registration), { recursive: true })
  await fs.writeFile(path.join(root, "config", "service-local.json"), JSON.stringify({ port }))
  await fs.writeFile(
    registration,
    JSON.stringify({
      id: "stale",
      version: OPENCODE_VERSION,
      url: "http://127.0.0.1:1",
      pid: 2_147_483_647,
      password: "stale",
    }),
  )
  const contender = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env: isolatedEnv(root),
    stderr: "pipe",
    stdout: "ignore",
  })
  const stderr = new Response(contender.stderr).text()
  try {
    // The first probe is preflight; the second only happens after start() fails to bind.
    expect(await Promise.race([recognizing.promise.then(() => true), Bun.sleep(20_000).then(() => false)])).toBe(true)
    expect(requests).toEqual(["/api/info", "/api/info"])
    await listener.stop(true)

    const info = await Promise.race([
      waitForInfo(registration, (info) => info.pid === contender.pid),
      contender.exited.then(() => undefined),
    ])
    expect(info?.pid, contender.exitCode === null ? undefined : await stderr).toBe(contender.pid)
    const endpoint = await Effect.runPromise(
      Service.discover({ file: registration }).pipe(
        Effect.filterOrFail((value) => value !== undefined),
        Effect.retry({ times: 400, schedule: Schedule.spaced("50 millis") }),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(new URL(endpoint.url).port).toBe(String(port))
    expect(
      await fetch(new URL("/api/info", endpoint.url), { headers: Service.headers(endpoint) }).then((response) =>
        response.json(),
      ),
    ).toMatchObject({ pid: contender.pid, version: OPENCODE_VERSION, urls: [endpoint.url] })
    expect(contender.exitCode).toBe(null)
    await Effect.runPromise(Service.stop({ file: registration }).pipe(Effect.provide(NodeFileSystem.layer)))
    expect(await waitForExit(contender)).toBe(true)
    expect(await Bun.file(registration).exists()).toBe(false)
    await expectPortAvailable(port)
  } finally {
    contender.kill("SIGTERM")
    await contender.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 45_000)

test("unresponsive managed port occupancy reports a bounded conflict", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-unresponsive-conflict-"))
  const recognizing = Promise.withResolvers<void>()
  const requests = { count: 0 }
  using listener = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      requests.count += 1
      if (requests.count === 2) recognizing.resolve()
      return new Promise<Response>(() => {})
    },
  })
  const registration = path.join(root, "state", "panacode", "service-local.json")
  await fs.mkdir(path.join(root, "config", "panacode"), { recursive: true })
  await fs.mkdir(path.dirname(registration), { recursive: true })
  await fs.writeFile(
    path.join(root, "config", "panacode", "service-local.json"),
    JSON.stringify({ port: listener.port, env: { XDG_STATE_HOME: path.join(root, "elsewhere") } }),
  )
  const stale = {
    id: "stale",
    version: OPENCODE_VERSION,
    url: "http://127.0.0.1:1",
    pid: process.pid,
    password: "stale",
  }
  await fs.writeFile(registration, JSON.stringify(stale))
  // The port lookup is a child of the service, so it shows the state directory tools would inherit.
  const lsof = process.platform === "win32" ? null : Bun.which("lsof")
  // Windows names the owner through netstat and tasklist instead of lsof.
  const namesOwner = process.platform === "win32" || lsof !== null
  if (lsof) {
    await Bun.write(
      path.join(root, "bin", "lsof"),
      `#!/bin/sh\nprintf %s "$XDG_STATE_HOME" > "${path.join(root, "inherited-state")}"\nexec "${lsof}" "$@"\n`,
    )
    await fs.chmod(path.join(root, "bin", "lsof"), 0o755)
  }
  const contender = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env: { ...serviceEnv(root), PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}` },
    stderr: "pipe",
    stdout: "pipe",
  })

  try {
    expect(await Promise.race([recognizing.promise.then(() => true), Bun.sleep(20_000).then(() => false)])).toBe(true)
    const exitCode = await Promise.race([contender.exited, Bun.sleep(20_000).then(() => undefined)])
    expect(exitCode).toBe(1)
    const output = (await new Response(contender.stdout).text()) + (await new Response(contender.stderr).text())
    expect(output).toContain(
      `Managed service port ${listener.port} on 127.0.0.1 is already in use by ${
        namesOwner ? `PID ${process.pid} (` : "another process"
      }`,
    )
    if (lsof) expect(await Bun.file(path.join(root, "inherited-state")).text()).toBe(path.join(root, "state"))
    expect(await Bun.file(registration).json()).toEqual(stale)
  } finally {
    contender.kill("SIGTERM")
    await contender.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 45_000)

test("port contender recognizes an incumbent registered during the bind race", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-bind-race-"))
  const recognizing = Promise.withResolvers<void>()
  const requests = { count: 0 }
  using listener = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === serviceProofPath) return healthProof(request, channel.control.token, "incumbent", "starting")
      requests.count += 1
      if (requests.count === 2) recognizing.resolve()
      return Response.json(
        {
          version: OPENCODE_VERSION,
          instance: "incumbent",
          product: "panacode",
          pid: process.pid,
          urls: [],
          paths: { tmp: "/tmp/panacode" },
        },
        { status: 503 },
      )
    },
  })
  const identity = {
      id: "incumbent",
      product: "panacode" as const,
      version: OPENCODE_VERSION,
      url: `http://127.0.0.1:${listener.port}`,
      pid: process.pid,
      password: "incumbent",
    }
  await using channel = await testControl(() => identity)
  const registration = path.join(root, "state", "panacode", "service-local.json")
  const config = path.join(root, "config", "panacode", "service-local.json")
  await fs.mkdir(path.dirname(config), { recursive: true })
  await fs.writeFile(config, JSON.stringify({ port: listener.port }))
  await fs.mkdir(path.dirname(registration), { recursive: true })
  await fs.writeFile(
    registration,
    JSON.stringify({
      id: "stale",
      version: OPENCODE_VERSION,
      url: "http://127.0.0.1:1",
      pid: 2_147_483_647,
      password: "stale",
    }),
  )
  const contender = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env: serviceEnv(root),
    stderr: "pipe",
    stdout: "ignore",
  })

  try {
    expect(await Promise.race([recognizing.promise.then(() => true), Bun.sleep(20_000).then(() => false)])).toBe(true)
    await Bun.sleep(8_000)
    const info = { ...identity, control: channel.control }
    await fs.writeFile(registration, JSON.stringify(info))

    expect(await Promise.race([contender.exited, Bun.sleep(20_000).then(() => undefined)])).toBe(0)
    expect(await Bun.file(registration).json()).toEqual(info)
  } finally {
    contender.kill("SIGTERM")
    await contender.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 45_000)

test("service registration replaces a stale owner with the bound address", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-stale-"))
  const registration = path.join(root, "state", "panacode", "service-local.json")
  await fs.mkdir(path.dirname(registration), { recursive: true })
  await fs.writeFile(
    registration,
    JSON.stringify({ id: "dead", version: "dead", url: "http://127.0.0.1:4321", pid: 2_147_483_647 }),
  )
  try {
    const cleanup = await Effect.runPromise(
      ServiceRegistration.register({
        controlToken: crypto.randomUUID(),
        expectedRegistration: await registrationSnapshot(registration),
        address: NetAddress.inetAddressFromIpStringUnsafe("127.0.0.1", 4321),
        password: "secret",
        id: "owner",
        file: registration,
        shutdown: Effect.never,
      }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
    )
    const info = (await Bun.file(registration).json()) as {
      id: string
      product: string
      version: string
      url: string
      pid: number
      password: string
      control: { path: string; token: string }
    }
    expect(info).toMatchObject({
      id: "owner",
      product: "panacode",
      version: OPENCODE_VERSION,
      url: "http://127.0.0.1:4321",
      pid: process.pid,
      password: "secret",
    })
    expect(info.control.path).toBeString()
    expect(info.control.token).toBeString()
    await Effect.runPromise(cleanup.pipe(Effect.provide(NodeFileSystem.layer)))
    expect(await Bun.file(registration).exists()).toBe(false)
    if (process.platform !== "win32") expect(await Bun.file(info.control.path).exists()).toBe(false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("a failed service stays registered and owns the selected port until stopped", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-failed-"))
  const port = await availablePort()
  const database = await corruptDatabase(root)
  await fs.mkdir(path.join(root, "config", "panacode"), { recursive: true })
  await fs.writeFile(path.join(root, "config", "panacode", "service-local.json"), JSON.stringify({ port }))
  const env = { ...serviceEnv(root), PANACODE_DB: database }
  const command = [process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"]
  const registration = path.join(root, "state", "panacode", "service-local.json")
  const owner = Bun.spawn(command, { env, stderr: "pipe", stdout: "ignore" })

  try {
    const info = await waitForInfo(registration)
    await waitForFailed(info)
    expect(owner.exitCode).toBe(null)

    const contender = Bun.spawn(command, { env, stderr: "pipe", stdout: "ignore" })
    expect(await Promise.race([contender.exited.then(() => true), Bun.sleep(10_000).then(() => false)])).toBe(true)
    expect(contender.exitCode).toBe(0)
    expect((await waitForInfo(registration)).id).toBe(info.id)
    expect(owner.exitCode).toBe(null)

    await Effect.runPromise(Service.stop({ file: registration }).pipe(Effect.provide(NodeFileSystem.layer)))
    await owner.exited
    expect(await Bun.file(registration).exists()).toBe(false)
  } finally {
    owner.kill("SIGTERM")
    await owner.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

async function waitForInfo(file: string, accept: (info: Info) => boolean = () => true) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const value = await Bun.file(file)
      .json()
      .catch(() => undefined)
    if (value !== undefined) {
      const info = await Schema.decodeUnknownPromise(Service.Info)(value)
      if (accept(info)) return info
    }
    await Bun.sleep(50)
  }
  throw new Error("Timed out waiting for service registration")
}

async function waitForFailed(info: Info) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const status = await fetch(new URL("/api/info", info.url), {
      headers: { authorization: "Basic " + btoa(`opencode:${info.password}`) },
    })
      .then((response) => response.status)
      .catch(() => undefined)
    if (status === 500) return
    await Bun.sleep(50)
  }
  throw new Error("Timed out waiting for service boot failure")
}

async function availablePort() {
  const server = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = server.port
  await server.stop(true)
  if (port === undefined) throw new Error("Server did not bind a port")
  return port
}

/** A registration watched in-process. `stops` advances the test clock until the watch shuts the server down. */
const registered = Effect.fnUntraced(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const file = path.join(yield* fileSystem.makeTempDirectoryScoped(), "service-local.json")
  const stopped = yield* Deferred.make<void>()
  const cleanup = yield* ServiceRegistration.register({
        controlToken: crypto.randomUUID(),
    address: NetAddress.inetAddressFromIpStringUnsafe("127.0.0.1", 4321),
    password: "secret",
    id: "owner",
    file,
    shutdown: Deferred.succeed(stopped, undefined).pipe(Effect.asVoid),
  })
  // Let the watch's immediate first check read the intact file, so the damage is found by a scheduled check.
  yield* TestClock.withLive(Effect.sleep("50 millis"))
  // Each check reads the file for real, so give that I/O live time between 5 s steps. Fail rather than hang.
  const stops = Effect.gen(function* () {
    for (const _ of Array.from({ length: 100 })) {
      if (yield* Deferred.isDone(stopped)) return
      yield* TestClock.adjust("5 seconds")
      yield* TestClock.withLive(Effect.sleep("10 millis"))
    }
    return yield* Effect.fail(new Error("The registration watch never shut the server down"))
  })
  return { fileSystem, file, stops, cleanup }
})

function serviceEnv(root: string) {
  return {
    ...process.env,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: transpilerCache,
    HOME: root,
    PANACODE_CONFIG_DIR: undefined,
    PANACODE_DB: path.join(root, "panacode.db"),
    PANACODE_TEST_HOME: root,
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
  }
}

async function corruptDatabase(root: string) {
  const directory = path.join(root, "data", "panacode")
  await fs.mkdir(directory, { recursive: true })
  const file = path.join(directory, "corrupt.db")
  await fs.writeFile(file, "not a SQLite database")
  return file
}

async function startManagedService(prefix: string, failBoot = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  const port = await availablePort()
  const registration = path.join(root, "state", "panacode", "service-local.json")
  await fs.mkdir(path.join(root, "config", "panacode"), { recursive: true })
  const database = failBoot ? await corruptDatabase(root) : undefined
  await fs.writeFile(path.join(root, "config", "panacode", "service-local.json"), JSON.stringify({ port }))
  const owner = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env: database ? { ...serviceEnv(root), PANACODE_DB: database } : serviceEnv(root),
    stderr: "pipe",
    stdout: "ignore",
  })
  const info = await waitForInfo(registration).catch(async (cause) => {
    owner.kill("SIGTERM")
    await owner.exited
    await fs.rm(root, { recursive: true, force: true })
    throw cause
  })
  return { root, port, registration, owner, info }
}

async function stopManagedService(service: Awaited<ReturnType<typeof startManagedService>>) {
  service.owner.kill("SIGTERM")
  await service.owner.exited
  await fs.rm(service.root, { recursive: true, force: true })
}

function waitForExit(process: Bun.Subprocess, timeout = 10_000) {
  return Promise.race([process.exited.then(() => true), Bun.sleep(timeout).then(() => false)])
}

async function expectPortAvailable(port: number) {
  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response() })
  await server.stop(true)
}
