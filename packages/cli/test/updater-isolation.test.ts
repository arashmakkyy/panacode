import { NodeServices } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { expect, spyOn } from "bun:test"
import { Effect, FileSystem, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import path from "node:path"
import { Updater } from "../src/services/updater"
import { testEffect } from "../../core/test/lib/effect"

const it = testEffect(NodeServices.layer)

function fixture() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "panacode-updater-" })
    const executable = path.join(root, "lib", "node_modules", "@opencode", "cli", "bin", "panacode")
    const manifest = path.join(root, "lib", "node_modules", "@opencode", "cli", "package.json")
    yield* fs.makeDirectory(path.dirname(executable), { recursive: true })
    yield* fs.writeFileString(executable, "binary")
    yield* fs.writeFileString(manifest, JSON.stringify({ name: "@opencode/cli", bin: { panacode: "bin/panacode" } }))

    const requests: string[] = []
    const fetch = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: string | URL | Request) => {
          requests.push(String(input))
          return Response.json({ version: "999.0.0", metadata: { package: "@opencode/cli" } })
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    )
    yield* Effect.addFinalizer(() => Effect.sync(() => fetch.mockRestore()))

    const commands: string[][] = []
    const global = Global.make({
      home: path.join(root, "home"),
      data: path.join(root, "data"),
      cache: path.join(root, "cache"),
      config: path.join(root, "config"),
      state: path.join(root, "state"),
      tmp: path.join(root, "tmp"),
      bin: path.join(root, "bin"),
      log: path.join(root, "log"),
      repos: path.join(root, "repos"),
    })
    const updater = yield* Updater.Service.pipe(
      Effect.provide(Updater.layer),
      Effect.provideService(Global.Service, global),
      Effect.provideService(FileSystem.FileSystem, {
        ...fs,
        realPath: (input) => (input === process.execPath ? fs.realPath(executable) : fs.realPath(input)),
      }),
      Effect.provideService(
        AppProcess.Service,
        AppProcess.Service.of({
          ...spawner,
          run: (command) =>
            Effect.sync(() => {
              if (command._tag !== "StandardCommand") throw new Error("Unexpected piped command")
              commands.push([command.command, ...command.args.map(String)])
              return {
                command: command.command,
                exitCode: 0,
                stdout: Buffer.from(command.args.includes("@opencode/cli") ? "@opencode/cli" : ""),
                stderr: Buffer.alloc(0),
                stdoutTruncated: false,
                stderrTruncated: false,
              }
            }),
          runStream: () => Stream.die("Unexpected streaming command"),
        }),
      ),
    )
    return { updater, commands, requests }
  })
}

it.live("run and check never contact an update feed", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    expect(yield* test.updater.run()).toBeUndefined()
    expect(yield* test.updater.check()).toEqual({
      type: "unavailable",
      message: expect.stringContaining("does not use an automatic update feed"),
    })
    expect(test.requests).toEqual([])
  }),
)

it.live("apply, latest, upgrade, and managed send the user to the manual release", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    for (const effect of [test.updater.apply("999.0.0"), test.updater.latest(), test.updater.upgrade("npm", "999.0.0")]) {
      const error = yield* effect.pipe(Effect.flip)
      expect(error).toBeInstanceOf(Updater.UpgradeError)
      expect(error.message).toContain("Panacode updates are installed manually")
    }
    const managed = yield* test.updater.managed("999.0.0")
    expect(managed).toBeInstanceOf(Updater.UpgradeError)
    expect(managed?.title).toBe("Panacode updates are manual")
    expect(test.requests).toEqual([])
    expect(test.commands).toEqual([])
  }),
)

it.live("still detects the installation method and removes the local package", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    expect(yield* test.updater.method()).toBe("npm")
    const removal = test.updater.removal("npm")
    if (!removal) return yield* Effect.die(new Error("Expected an npm removal command"))
    expect(removal.command.slice(0, 3)).toEqual(["npm", "uninstall", "--global"])
    yield* removal.run
    expect(test.commands.at(-1)).toEqual([...removal.command])
    expect(test.requests).toEqual([])
  }),
)