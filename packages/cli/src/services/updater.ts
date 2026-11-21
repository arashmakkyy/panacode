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

const decodeVpPackages = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Struct({ name: Schema.String }))),
)

const wingetPackage = "Anomaly.Panacode"
const wingetArgs = [
  "--id",
  wingetPackage,
  "--exact",
  "--source",
  "winget",
  "--accept-source-agreements",
  "--disable-interactivity",
]

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
  const installedPackage = yield* Effect.gen(function* () {
    const directory = path.dirname(path.dirname(executable))
    const manifest: { name: string; bin?: Record<string, string> } = yield* fs
      .readFileString(path.join(directory, "package.json"))
      .pipe(Effect.flatMap((text) => Effect.try(() => JSON.parse(text))))
    // Source invocations run inside Bun or Node, which may themselves be npm packages.
    if (!/^@opencode(?:-ai)?\/cli(?:-node)?$/.test(manifest.name)) return
    if (Object.values(manifest.bin ?? {}).some((bin) => path.resolve(directory, bin) === executable))
      return manifest.name
  }).pipe(Effect.orElseSucceed(() => undefined))
  // "opencode" is Homebrew Core's formula; the others are published to anomalyco/tap.
  const installedFormula = ["opencode", "opencode-beta", "opencode-v2"].find((name) =>
    executable.includes(`${path.sep}Cellar${path.sep}${name}${path.sep}`),
  )
  // WinGet extracts portable packages into a directory named after the package identifier.
  const installedWinget = /[\\/]winget[\\/]packages[\\/]anomaly\.opencode_/i.test(executable)
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
  // npm keeps global packages in <prefix>/lib/node_modules on POSIX. The npm on PATH may belong to another Node
  // install (fnm, nvm, mise) or prefix, so target the prefix that owns the running binary. Windows uses
  // <prefix>\node_modules, which Bun and pnpm global installs share, so it keeps the npm on PATH.
  const packageDirectory = path.dirname(path.dirname(executable))
  const npmPackageDirectory = installedPackage ? path.join("/lib/node_modules", installedPackage) : undefined
  const npmPrefix =
    npmPackageDirectory &&
    !installedOwner &&
    process.platform !== "win32" &&
    packageDirectory.endsWith(npmPackageDirectory)
      ? packageDirectory.slice(0, -npmPackageDirectory.length) || undefined
      : undefined
  const npmPrefixArgs = npmPrefix ? ["--prefix", npmPrefix] : []
  const npmBin = npmPrefix ? path.join(npmPrefix, "bin") : undefined
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
  const curlBinary = yield* fs.realPath(curlPath).pipe(Effect.orElseSucceed(() => curlPath))

  const method = Effect.fnUntraced(function* () {
    if (executable === curlBinary) return "curl"
    if (installedFormula) return "brew"
    if (installedWinget) return "winget"
    if (!installedPackage || installedOwner) return

    const parts = executable.toLowerCase().split(path.sep).map((part) => part.replace(/^\./, ""))
    const checks: Array<{ method: Method; command: string[] }> = [
      { method: "npm", command: [npm, "list", "-g", "--depth=0", ...npmPrefixArgs, installedPackage] },
      { method: "pnpm", command: ["pnpm", "list", "-g", "--depth=0", installedPackage] },
      { method: "bun", command: ["bun", "pm", "ls", "-g"] },
      { method: "yarn", command: ["yarn", "global", "list"] },
      { method: "vp", command: ["vp", "list", "-g", "--json", installedPackage] },
    ]
    checks.sort((a, b) => Number(parts.includes(b.method)) - Number(parts.includes(a.method)))
    const results = yield* Effect.forEach(
      checks,
      (check) =>
        exec(check.command).pipe(
          Effect.orElseSucceed(() => ({ code: 1, stdout: "", stderr: "" })),
          Effect.map((result) => ({ check, result })),
        ),
      { concurrency: "unbounded" },
    )
    return results.find((result) => {
      if (result.check.method !== "vp") return result.result.stdout.includes(installedPackage)
      // Vite+ repeats the filter in its successful no-match message, so substring detection would be a false positive.
      return Option.exists(decodeVpPackages(result.result.stdout), (packages) =>
        packages.some((item) => item.name === installedPackage),
      )
    })?.check.method
  })

  const removalCommand = (method: Method) => {
    if (method === "winget") return ["winget", "uninstall", ...wingetArgs]
    if (method === "curl" || method === "brew" || !installedPackage) return undefined
    const commands = {
      npm: [npm, "uninstall", "--global", ...npmPrefixArgs, installedPackage],
      pnpm: ["pnpm", "remove", "--global", installedPackage],
      bun: ["bun", "remove", "--global", installedPackage],
      yarn: ["yarn", "global", "remove", installedPackage],
      vp: ["vp", "uninstall", "-g", installedPackage],
    }
    return commands[method]
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
    if (process.platform !== "win32" || method === "brew") return effect
    // Only the installed binary is at stake; source checkouts run inside bun or node.
    const owned =
      method === "curl"
        ? executable === curlBinary
        : method === "winget"
          ? installedWinget
          : installedPackage !== undefined
    if (!owned) return effect
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

  return Service.of({ run, check, apply, method, managed, latest, upgrade, removal })
})

export const layer = Layer.effect(Service, make)

export * as Updater from "./updater"
export { action, type Action, type Policy } from "./updater-action"