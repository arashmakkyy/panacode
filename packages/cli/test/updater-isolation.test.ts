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

function packagePath(name: string, binary: string) {
  return path.join(...(process.platform === "win32" ? [] : ["lib"]), "node_modules", ...name.split("/"), "bin", binary)
}

function fixture(
  input: {
    readonly executable?: string
    /** Where the executable path resolves, i.e. the target of a symlinked bin entry. */
    readonly resolved?: string
    /** null means no package manifest at all. */
    readonly manifest?: { readonly name: string; readonly bin?: Record<string, string> | null } | null
    readonly stdout?: (argv: readonly string[]) => string
  } = {},
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "panacode-updater-" })
    const home = path.join(root, "home")
    const executable = path.resolve(root, input.executable ?? packagePath("panacode", "panacode"))
    const resolved = input.resolved ? path.resolve(root, input.resolved) : executable
    yield* fs.makeDirectory(path.dirname(executable), { recursive: true })
    yield* fs.writeFileString(executable, "binary")
    if (resolved !== executable) {
      yield* fs.makeDirectory(path.dirname(resolved), { recursive: true })
      yield* fs.writeFileString(resolved, "binary")
      if (process.platform !== "win32") {
        yield* fs.remove(executable)
        yield* fs.symlink(resolved, executable)
      }
    }
    if (input.manifest !== null) {
      const packageDirectory = path.dirname(path.dirname(resolved))
      const bin = input.manifest?.bin
      const manifest =
        bin === null
          ? { name: input.manifest?.name ?? "panacode" }
          : {
              name: input.manifest?.name ?? "panacode",
              bin: bin ?? { [path.basename(resolved)]: path.relative(packageDirectory, resolved) },
            }
      yield* fs.makeDirectory(packageDirectory, { recursive: true })
      yield* fs.writeFileString(path.join(packageDirectory, "package.json"), JSON.stringify(manifest))
    }

    const requests: string[] = []
    const fetch = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: string | URL | Request) => {
          requests.push(String(input))
          return Response.json({ version: "999.0.0", metadata: { package: "panacode" } })
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    )
    yield* Effect.addFinalizer(() => Effect.sync(() => fetch.mockRestore()))

    const commands: string[][] = []
    const links: string[] = []
    const global = Global.make({
      home,
      data: path.join(root, "data"),
      cache: path.join(root, "cache", "panacode"),
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
        realPath: (input) => (input === process.execPath ? Effect.succeed(resolved) : fs.realPath(input)),
        link: (fromPath, toPath) =>
          fs.link(fromPath, toPath).pipe(Effect.tap(() => Effect.sync(() => links.push(toPath)))),
      }),
      Effect.provideService(
        AppProcess.Service,
        AppProcess.Service.of({
          ...spawner,
          run: (command) =>
            Effect.sync(() => {
              if (command._tag !== "StandardCommand") throw new Error("Unexpected piped command")
              const argv = [command.command, ...command.args.map(String)]
              commands.push(argv)
              return {
                command: command.command,
                exitCode: 0,
                stdout: Buffer.from(input.stdout?.(argv) ?? ""),
                stderr: Buffer.alloc(0),
                stdoutTruncated: false,
                stderrTruncated: false,
              }
            }),
          runStream: () => Stream.die("Unexpected streaming command"),
        }),
      ),
    )
    return { updater, commands, links, requests, root, home, executable: resolved, fs, global }
  })
}

const destructive = (argv: readonly string[]) =>
  argv.slice(1).some((argument) => argument === "uninstall" || argument === "remove")

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
    for (const effect of [
      test.updater.apply("999.0.0"),
      test.updater.latest(),
      test.updater.upgrade("npm", "999.0.0"),
    ]) {
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

it.live("upstream OpenCode package identities never prove Panacode ownership", () =>
  Effect.gen(function* () {
    for (const name of ["@opencode/cli", "@opencode/cli-node", "@opencode-ai/cli", "@opencode-ai/cli-node"]) {
      const test = yield* fixture({ manifest: { name }, stdout: () => "panacode@1.0.0" })
      const ownership = yield* test.updater.ownership()
      expect(ownership, name).toMatchObject({
        owned: false,
        detail: expect.stringContaining(`package "${name}"`),
      })
      expect(yield* test.updater.method(), name).toBeUndefined()
      for (const method of Updater.methods) expect(test.updater.removal(method), name).toBeUndefined()
      expect(test.commands, name).toEqual([])
      expect(test.links, name).toEqual([])
    }
  }),
)

it.live("foreign and similar package names never produce a removal command", () =>
  Effect.gen(function* () {
    for (const name of ["panacode-cli", "@panacode/cli", "opencode", "opencode-ai"]) {
      const test = yield* fixture({ manifest: { name }, stdout: () => `${name}@1.0.0` })
      expect(yield* test.updater.ownership(), name).toMatchObject({
        owned: false,
        detail: expect.stringContaining(`package "${name}"`),
      })
      expect(yield* test.updater.method(), name).toBeUndefined()
      expect(test.updater.removal("npm"), name).toBeUndefined()
      expect(test.commands.filter(destructive), name).toEqual([])
      expect(test.links, name).toEqual([])
    }
  }),
)

it.live("a panacode name with a manifest that does not own the executable is unproven", () =>
  Effect.gen(function* () {
    const test = yield* fixture({
      manifest: { name: "panacode", bin: { panacode: "bin/other" } },
      stdout: () => "panacode@1.0.0",
    })
    expect(yield* test.updater.ownership()).toMatchObject({
      owned: false,
      detail: expect.stringContaining("does not declare the running executable"),
    })
    expect(yield* test.updater.method()).toBeUndefined()
    expect(test.updater.removal("npm")).toBeUndefined()
    expect(test.commands).toEqual([])
    expect(test.links).toEqual([])
  }),
)

it.live("a symlinked executable does not inherit the package identity of its path", () =>
  Effect.gen(function* () {
    const test = yield* fixture({
      executable: packagePath("panacode", "panacode"),
      resolved: packagePath("@opencode/cli", "panacode"),
      manifest: { name: "@opencode/cli" },
      stdout: () => "panacode@1.0.0",
    })
    expect(yield* test.updater.ownership()).toMatchObject({
      owned: false,
      detail: expect.stringContaining('package "@opencode/cli"'),
    })
    expect(yield* test.updater.method()).toBeUndefined()
    expect(test.updater.removal("npm")).toBeUndefined()
    expect(test.commands).toEqual([])
    expect(test.links).toEqual([])
  }),
)

it.live("two prefixes cannot make an upstream executable look Panacode-owned", () =>
  Effect.gen(function* () {
    const test = yield* fixture({ manifest: { name: "@opencode/cli" }, stdout: () => "panacode@1.0.0" })
    const other = path.join(test.root, "other", packagePath("panacode", "panacode"))
    yield* test.fs.makeDirectory(path.dirname(other), { recursive: true })
    yield* test.fs.writeFileString(other, "binary")
    yield* test.fs.writeFileString(
      path.join(path.dirname(path.dirname(other)), "package.json"),
      JSON.stringify({ name: "panacode", bin: { panacode: "bin/panacode" } }),
    )

    expect(yield* test.updater.ownership()).toMatchObject({ owned: false })
    expect(yield* test.updater.method()).toBeUndefined()
    expect(test.updater.removal("npm")).toBeUndefined()
    expect(test.commands).toEqual([])
    expect(test.links).toEqual([])
  }),
)

it.live("Homebrew and WinGet paths from upstream are explanations, not owners", () =>
  Effect.gen(function* () {
    const brew = yield* fixture({
      executable: "opt/homebrew/Cellar/opencode-v2/2.0.0/bin/opencode",
      manifest: null,
    })
    expect(yield* brew.updater.ownership()).toMatchObject({
      owned: false,
      detail: expect.stringContaining('Homebrew formula "opencode-v2"'),
    })
    expect(yield* brew.updater.method()).toBeUndefined()
    expect(brew.updater.removal("brew")).toBeUndefined()
    expect(brew.commands).toEqual([])
    expect(brew.links).toEqual([])

    const winget = yield* fixture({
      executable: "AppData/Local/Microsoft/WinGet/Packages/anomaly.opencode_2.0.0_x64__hash/opencode.exe",
      manifest: null,
    })
    expect(yield* winget.updater.ownership()).toMatchObject({
      owned: false,
      detail: expect.stringContaining('WinGet package "anomaly.opencode"'),
    })
    expect(yield* winget.updater.method()).toBeUndefined()
    expect(winget.updater.removal("winget")).toBeUndefined()
    expect(winget.commands).toEqual([])
    expect(winget.links).toEqual([])
  }),
)

it.live("a Panacode manifest that no package manager reports stays inert", () =>
  Effect.gen(function* () {
    const test = yield* fixture({ manifest: { name: "panacode" } })
    expect(yield* test.updater.ownership()).toMatchObject({
      owned: false,
      detail: expect.stringContaining("No supported global package manager reports panacode"),
    })
    expect(yield* test.updater.method()).toBeUndefined()
    expect(test.updater.removal("npm")).toBeUndefined()
    expect(test.commands.filter(destructive)).toEqual([])
    expect(test.links).toEqual([])
  }),
)

it.live("a supported Panacode npm package removes only from its own prefix", () =>
  Effect.gen(function* () {
    const test = yield* fixture({
      manifest: { name: "panacode" },
      stdout: (argv) => (path.basename(argv[0] ?? "") === "npm" ? "panacode@1.0.0" : ""),
    })
    // A direct removal call cannot bypass detection.
    expect(test.updater.removal("npm")).toBeUndefined()
    expect(test.commands).toEqual([])

    expect(yield* test.updater.ownership()).toMatchObject({
      owned: true,
      method: "npm",
      package: "panacode",
      binary: test.executable,
    })
    const removal = test.updater.removal("npm")
    if (!removal) return yield* Effect.die(new Error("Expected an npm removal command"))
    expect(removal.command[0]).toBe("npm")
    expect(removal.command).toContain("uninstall")
    expect(removal.command[removal.command.indexOf("--prefix") + 1]).toBe(test.root)
    expect(removal.command.at(-1)).toBe("panacode")

    yield* removal.run
    expect(test.commands.at(-1)).toEqual([...removal.command])
    if (process.platform === "win32") {
      expect(test.links).toHaveLength(1)
      expect(test.links[0]).toMatch(/panacode-upgrade-\d+-[0-9a-f]+\.exe$/)
    } else {
      expect(test.links).toEqual([])
    }
    expect(test.requests).toEqual([])
  }),
)

it.live("the node distribution package is a positive owner", () =>
  Effect.gen(function* () {
    const test = yield* fixture({
      executable: packagePath("@panacode/cli-node", "panacode-node"),
      manifest: { name: "@panacode/cli-node" },
      stdout: (argv) => (path.basename(argv[0] ?? "") === "npm" ? "@panacode/cli-node@1.0.0" : ""),
    })
    expect(yield* test.updater.ownership()).toMatchObject({
      owned: true,
      method: "npm",
      package: "@panacode/cli-node",
    })
    const removal = test.updater.removal("npm")
    if (!removal) return yield* Effect.die(new Error("Expected an npm removal command"))
    expect(removal.command.at(-1)).toBe("@panacode/cli-node")
    yield* removal.run
    expect(test.commands.at(-1)).toEqual([...removal.command])
  }),
)

it.live("a supported curl install is a positive owner and keeps removal manual", () =>
  Effect.gen(function* () {
    const binary = path.join("home", ".panacode", "bin", process.platform === "win32" ? "panacode.exe" : "panacode")
    const test = yield* fixture({ executable: binary, manifest: null })
    expect(yield* test.updater.ownership()).toMatchObject({
      owned: true,
      method: "curl",
      binary: path.resolve(test.root, binary),
    })
    expect(yield* test.updater.method()).toBe("curl")
    expect(test.updater.removal("curl")).toBeUndefined()
    expect(test.commands).toEqual([])
    expect(test.links).toEqual([])
  }),
)
