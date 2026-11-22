import { Global } from "@opencode/util/global"
import { ProductIdentity } from "@opencode/util/product-identity"
import { AppProcess } from "@opencode/util/process"
import { OPENCODE_VERSION } from "../version"
import { Context, Duration, Effect, FileSystem, Layer, Option, Schema } from "effect"
import { ChildProcess } from "effect/process"
import { parse, type ParseError } from "jsonc-parser"
import path from "node:path"
import { stripVTControlCharacters } from "node:util"
import { RetainedImage } from "./retained-image"
import type { Policy } from "./updater-action"

export const methods = ["curl", "npm", "pnpm", "bun", "yarn", "vp", "brew", "winget"] as const

export type Method = (typeof methods)[number]
export type RunResult = { readonly type: "available" | "installed"; readonly version: string }
export type CheckResult = RunResult | { readonly type: "unavailable"; readonly message: string }
export type Ownership =
  | { readonly owned: true; readonly method: Method; readonly binary: string; readonly package?: string }
  | { readonly owned: false; readonly binary: string; readonly detail: string }

// Panacode ships through GitHub Releases and has no update feed yet. This is the CLI counterpart of
// PANACODE_UPSTREAM_UPDATES in packages/gui-plugins/src/updater/panacode.ts. Turn both on only when
// Panacode publishes its own feed and installer.
const releaseUrl = "https://github.com/arashmakkyy/panacode/releases"

export class UpgradeError extends Error {
  readonly title: string
  readonly detail: string
  readonly command?: string
  readonly retry: string

  constructor(
    input: {
      readonly title: string
      readonly detail: string
      readonly command?: string
      readonly retry: string
    },
    options?: ErrorOptions,
  ) {
    super(input.detail, options)
    this.name = "UpgradeError"
    this.title = input.title
    this.detail = input.detail
    this.command = input.command
    this.retry = input.retry
  }
}

const decodeManifest = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      name: Schema.String,
      bin: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
)

// The top-level package identities produced by packages/cli/script/pack.ts. The upstream
// @opencode/cli family is OpenCode, not Panacode, and a package manager on PATH is not evidence of
// ownership. No Homebrew formula or WinGet identifier is published by this fork yet, so neither
// location is treated as proof instead of guessing an upstream-looking name.
const packagedPackages = new Set(["panacode", "@panacode/cli-node"])

function conciseDetail(input: string) {
  const lines = stripVTControlCharacters(input)
    .trim()
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
  const tail = lines.slice(-12).join("\n")
  const clipped = tail.length > 2_000
  const detail = clipped ? `…${tail.slice(-1_999)}` : tail
  if (!detail) return
  if (lines.length <= 12 && !clipped) return detail
  return `${detail}\n\nOutput shortened to the last 12 lines.`
}

function resultDetail(result: { code: number; stdout: string; stderr: string }) {
  return (
    conciseDetail(result.stderr) ??
    conciseDetail(result.stdout) ??
    `The command exited with code ${result.code} without any error output.`
  )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** The prefix whose global node_modules contains `directory`, or undefined for another layout. */
function packagePrefix(directory: string, name: string) {
  const marker = `${path.sep}node_modules${path.sep}${name.split("/").join(path.sep)}`
  if (!directory.endsWith(marker)) return
  const parent = directory.slice(0, -marker.length)
  if (!parent) return
  // npm on POSIX uses <prefix>/lib/node_modules; Windows and the other managers use
  // <prefix>/node_modules, so only strip the extra lib segment when the layout has it.
  return path.basename(parent) === "lib" ? path.dirname(parent) : parent
}

function manualUpdate() {
  return new UpgradeError({
    title: "Panacode updates are manual",
    detail: `Panacode updates are installed manually, never through an automatic feed or installer. Download the latest Panacode build from ${releaseUrl}.`,
    retry: "Install the newer build, then restart Panacode.",
  })
}

export interface Interface {
  readonly run: (onInstall?: (version: string) => void) => Effect.Effect<RunResult | undefined>
  readonly check: () => Effect.Effect<CheckResult | undefined, Error>
  readonly apply: (version: string) => Effect.Effect<void, Error>
  readonly method: () => Effect.Effect<Method | undefined>
  /** Proves that Panacode, rather than an upstream OpenCode install, owns the running executable. */
  readonly ownership: () => Effect.Effect<Ownership>
  /** Explains how to update a copy that Volta or mise manages, which `method` leaves undetected. */
  readonly managed: (version?: string) => Effect.Effect<UpgradeError | undefined, Error>
  readonly latest: (method?: Method) => Effect.Effect<string, Error>
  readonly upgrade: (method: Method, version: string) => Effect.Effect<void, Error>
  readonly removal: (
    method: Method,
  ) => { readonly command: ReadonlyArray<string>; readonly run: Effect.Effect<void, Error> } | undefined
}

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/Updater") {}

export function decodePolicy(text: string): Policy | undefined {
  // The CLI only projects this host-level preference instead of initializing
  // the location-scoped server configuration graph.
  const errors: ParseError[] = []
  const input: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || typeof input !== "object" || input === null) return
  if ("update" in input) {
    const value = input.update
    if (value === "disable" || value === "notify" || value === "auto") return value
    return
  }
  if (!("autoupdate" in input)) return
  if (input.autoupdate === false) return "disable"
  if (input.autoupdate === "notify") return "notify"
  if (input.autoupdate === true) return "auto"
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const global = yield* Global.Service
  const appProcess = yield* AppProcess.Service
  const executable = yield* fs.realPath(process.execPath).pipe(Effect.orElseSucceed(() => process.execPath))
  const packageDirectory = path.dirname(path.dirname(executable))
  const manifest = yield* fs.readFileString(path.join(packageDirectory, "package.json")).pipe(
    Effect.map((text) => Option.getOrUndefined(decodeManifest(text))),
    Effect.orElseSucceed(() => undefined),
  )
  // Ownership needs both a packaged Panacode identity and a bin entry naming this exact executable.
  // A similar package name, a manager on PATH, or an upstream @opencode/cli manifest proves nothing.
  const installedPackage =
    manifest &&
    packagedPackages.has(manifest.name) &&
    Object.values(manifest.bin ?? {}).some((bin) => path.resolve(packageDirectory, bin) === executable)
      ? manifest.name
      : undefined
  const foreignManifest = manifest && !packagedPackages.has(manifest.name) ? manifest.name : undefined
  // These paths explain why an install is not ours. They are not owners because this fork publishes
  // neither a Homebrew formula nor a WinGet package.
  const formula = /[\\/]Cellar[\\/]([^\\/]+)[\\/]/.exec(executable)?.[1]
  const winget = /[\\/]winget[\\/]packages[\\/]([^\\/\\s]+)/i.exec(executable)?.[1]?.split("_")[0]
  // Volta packages (tools/image/packages) and mise's npm backend (installs/npm-<name>) keep their own record of the
  // installed version, so updating the copy in place would leave it stale. npm globals under a Volta or mise Node
  // (tools/image/node, installs/node) are ordinary npm installs.
  const installedOwner = !installedPackage
    ? undefined
    : /[\\/]tools[\\/]image[\\/]packages[\\/]/.test(executable)
      ? { name: "Volta", command: "volta install " }
      : /[\\/]installs[\\/]npm-[^\\/]+[\\/]/.test(executable)
        ? { name: "mise", command: "mise use -g npm:" }
        : undefined
  // Target the prefix that owns the running package. On POSIX npm uses <prefix>/lib/node_modules;
  // Windows and the other managers use <prefix>/node_modules. npm keeps using its own binary when
  // the prefix has one, and otherwise the npm on PATH is scoped to the proven prefix.
  const npmPrefix = installedPackage && !installedOwner ? packagePrefix(packageDirectory, installedPackage) : undefined
  const npmPrefixArgs = npmPrefix ? ["--prefix", npmPrefix] : []
  const npmBin = npmPrefix && process.platform !== "win32" ? path.join(npmPrefix, "bin") : undefined
  const prefixNpm =
    npmBin && (yield* fs.exists(path.join(npmBin, "npm")).pipe(Effect.orElseSucceed(() => false)))
      ? path.join(npmBin, "npm")
      : undefined
  const npm = prefixNpm ?? "npm"

  const exec = Effect.fnUntraced(function* (command: string[], timeout: Duration.Input = "30 seconds") {
    // The prefix's npm and the package's postinstall run `node` from PATH, which may be missing or belong to another
    // Node install, so put the prefix's own node first.
    const options =
      command[0] === prefixNpm
        ? { env: { PATH: [npmBin, process.env.PATH].filter(Boolean).join(path.delimiter) }, extendEnv: true }
        : undefined
    return yield* appProcess
      .run(ChildProcess.make(command[0], command.slice(1), options), {
        timeout,
        maxOutputBytes: 100_000,
        maxErrorBytes: 100_000,
      })
      .pipe(
        Effect.map((result) => ({
          code: result.exitCode,
          stdout: result.stdout.toString("utf8"),
          stderr: result.stderr.toString("utf8"),
        })),
      )
  })

  const curlPath = path.resolve(
    global.home,
    ProductIdentity.installDir,
    "bin",
    process.platform === "win32" ? `${ProductIdentity.cli}.exe` : ProductIdentity.cli,
  )
  const curlBinary = yield* fs.realPath(curlPath).pipe(Effect.orElseSucceed(() => undefined))

  const detectMethod = Effect.fnUntraced(function* () {
    if (curlPath === curlBinary && executable === curlBinary) return "curl" as const
    if (!installedPackage || installedOwner) return

    // npm's explicit prefix and global layout must both select this installation.
    // Other managers cannot scope their removal command to the verified manifest.
    if (!npmPrefix) return
    const modules = process.platform === "win32" ? "node_modules" : path.join("lib", "node_modules")
    if (path.relative(path.join(npmPrefix, modules, installedPackage), packageDirectory) !== "") return
    const result = yield* exec([npm, "list", "-g", "--depth=0", ...npmPrefixArgs, installedPackage]).pipe(
      Effect.orElseSucceed(() => ({ code: 1, stdout: "" })),
    )
    const listed = new RegExp(`(?:^|[\\s/"'])${escapeRegExp(installedPackage)}@`, "m")
    if (result.code === 0 && listed.test(result.stdout)) return "npm" as const
  })

  // removal(method) is synchronous so uninstall can print its plan before confirmation. Cache the one
  // detection it may use; a direct removal call before any detection stays inert.
  let detectedMethod: { readonly value: Method | undefined } | undefined
  const method = Effect.fnUntraced(function* () {
    if (detectedMethod) return detectedMethod.value
    const value = yield* detectMethod()
    detectedMethod = { value }
    return value
  })

  const unownedDetail = () => {
    if (formula)
      return `Homebrew formula "${formula}" is not a published Panacode formula, so Panacode will not remove it.`
    if (winget) return `WinGet package "${winget}" is not a published Panacode package, so Panacode will not remove it.`
    if (foreignManifest)
      return `The running executable belongs to package "${foreignManifest}", which is not a Panacode package.`
    if (manifest && !installedPackage)
      return `The package manifest at ${packageDirectory} does not declare the running executable, so Panacode ownership is unproven.`
    if (!installedPackage) return "No Panacode installer or published package owns the running executable."
    if (installedOwner)
      return `Panacode is managed by ${installedOwner.name}; remove it with that tool instead of a global package manager.`
    return `No supported global package manager reports ${installedPackage} at ${packageDirectory}, so Panacode ownership is unproven.`
  }

  const ownership = Effect.fnUntraced(function* () {
    const detected = yield* method()
    if (detected === "curl") return { owned: true as const, method: detected, binary: curlPath }
    if (detected) return { owned: true as const, method: detected, binary: executable, package: installedPackage }
    return { owned: false as const, binary: executable, detail: unownedDetail() }
  })

  // The one ownership predicate used by command construction, execution, and retained images.
  const owns = (method: Method) => detectedMethod?.value === method

  const removalCommand = (method: Method) => {
    if (!owns(method) || !installedPackage) return
    if (method === "npm" && npmPrefix) return [npm, "uninstall", "--global", ...npmPrefixArgs, installedPackage]
  }

  const removal = (method: Method) => {
    const command = removalCommand(method)
    if (!command) return undefined
    return {
      command,
      run: retaining(
        method,
        exec(command, "5 minutes").pipe(
          Effect.flatMap((result) => (result.code === 0 ? Effect.void : Effect.fail(new Error(resultDetail(result))))),
        ),
        global.tmp,
      ),
    }
  }

  // On Windows the installer must delete or replace the running binary, which only works
  // while another link to it exists (see RetainedImage). Uninstall has already removed the
  // cache, so it uses the temporary directory.
  const retaining = <A, E, R>(method: Method, effect: Effect.Effect<A, E, R>, directory = global.cache) => {
    if (process.platform !== "win32" || !owns(method)) return effect
    return Effect.scoped(RetainedImage.retain(directory, "upgrade").pipe(Effect.andThen(effect))).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
    )
  }

  const run = Effect.fn("cli.updater.run")(function* (_onInstall: (version: string) => void = () => {}) {
    yield* Effect.logInfo("update check skipped", {
      reason: "manual-updates",
      version: OPENCODE_VERSION,
    })
    return undefined
  })

  const check = Effect.fn("cli.updater.check")(function* () {
    return {
      type: "unavailable" as const,
      message: `Panacode ${OPENCODE_VERSION} does not use an automatic update feed. Download the latest release from ${releaseUrl}.`,
    }
  })

  const apply = Effect.fn("cli.updater.apply")(function* (_version: string) {
    return yield* Effect.fail(manualUpdate())
  })

  const managed = Effect.fnUntraced(function* (_version?: string) {
    return manualUpdate()
  })

  const latest = Effect.fnUntraced(function* (_method?: Method) {
    return yield* Effect.fail(manualUpdate())
  })

  const upgrade = Effect.fnUntraced(function* (_method: Method, _version: string) {
    return yield* Effect.fail(manualUpdate())
  })

  return Service.of({ run, check, apply, method, ownership, managed, latest, upgrade, removal })
})

export const layer = Layer.effect(Service, make)

export * as Updater from "./updater"
export { action, type Action, type Policy } from "./updater-action"
