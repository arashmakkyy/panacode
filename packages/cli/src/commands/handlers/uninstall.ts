import { confirm, intro, log, outro, spinner } from "@clack/prompts"
import { Service } from "@opencode/client/effect/service"
import { Global } from "@opencode/util/global"
import { ProductIdentity } from "@opencode/util/product-identity"
import { Effect, FileSystem, Schedule } from "effect"
import path from "node:path"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"
import { RetainedImage } from "../../services/retained-image"
import { Updater } from "../../services/updater"
import {
  cleanShellConfig,
  cleanShellFile,
  isFishConfig,
  shellConfigCandidates,
  shellPathCommands,
  shellPathShared,
} from "../../services/shell-config"
import { handlePromptErrors, prompt, requireInteractive } from "../../ui/prompt"
import { errorMessage } from "../../util/error"

export default Runtime.handler(
  Commands.commands.uninstall,
  Effect.fn("cli.uninstall")(function* (input) {
    intro("Uninstall Panacode")
    const fs = yield* FileSystem.FileSystem
    const global = yield* Global.Service
    const updater = yield* Updater.Service
    const ownership = yield* updater.ownership()
    const method = ownership.owned ? ownership.method : undefined
    const removal = method ? updater.removal(method) : undefined
    // Data, config, and state hold sessions, credentials, settings, and prompt history; uninstall only removes the cache.
    // All channels share the cache. Stop background services before deleting it.
    // Read registrations directly: ServiceConfig.options() can migrate files even during a dry run.
    const services = (yield* fs.exists(global.state))
      ? (yield* fs.readDirectory(global.state)).filter((name) => /^service(?:-.*)?\.json$/.test(name))
      : []
    const bin = path.dirname(process.execPath)
    const shell = method === "curl" ? yield* shellConfigs(global.home, bin) : []
    const cache = yield* privateCache(fs, global.cache)

    log.info(`Installation method: ${method ?? "unknown"}`)
    if (!ownership.owned) {
      log.warn("Panacode ownership not proven; no package or executable will be removed.")
      log.message(ownership.detail)
      log.message("If this executable is a Panacode build you installed yourself, delete that exact file.")
    }
    log.message("The following global files will be removed (shared by Panacode versions and channels):")
    if (cache.status === "safe") log.info(`  Cache: ${cache.path}`)
    if (cache.status === "unsafe")
      log.warn(`  Cache is a symlink or shared alias and will be left untouched: ${cache.path}`)
    services.forEach((name) =>
      log.info(`  Stop background service and persistent terminals: ${path.join(global.state, name)}`),
    )
    shell.forEach((file) => log.info(`  Shell PATH: ${file}`))
    if (removal) log.info(`  Package: ${removal.command.join(" ")}`)
    if (ownership.owned && ownership.method === "curl") log.info(`  Binary (manual removal): ${ownership.binary}`)

    if (input.dryRun) {
      log.warn("Dry run - no changes made")
      outro("Done")
      return
    }
    if (!input.force) {
      yield* requireInteractive("Use --force to uninstall without an interactive terminal, or --dry-run to preview.")
      const accepted = yield* prompt(() =>
        confirm({ message: "Are you sure you want to uninstall?", initialValue: false }),
      )
      if (!accepted) {
        outro("Cancelled")
        return
      }
    }

    const progress = spinner()
    if (services.length) {
      progress.start("Stopping background services...")
      yield* Effect.forEach(services, (name) =>
        Effect.gen(function* () {
          const options = { file: path.join(global.state, name) }
          yield* ServerConnection.shutdownPersistentPty(options).pipe(Effect.ignore)
          yield* Service.stop(options)
        }),
      ).pipe(
        Effect.tap(() => Effect.sync(() => progress.stop("Background services stopped"))),
        Effect.tapCause(() => Effect.sync(() => progress.stop("Failed to stop background services", 1))),
      )
    }

    // Links that keep an older OpenCode replaceable may still run; move them so the cache can go.
    const errors: string[] = []
    if (cache.status === "safe") {
      if (process.platform === "win32") yield* RetainedImage.relocate(cache.path, global.tmp)
      progress.start("Removing Cache...")
      yield* fs.remove(cache.path, { recursive: true, force: true }).pipe(
        // Windows reports a terminated service as gone before it releases its file handles,
        // so the first removal can race that teardown.
        Effect.retry({
          while: (error) => process.platform === "win32" && error.reason._tag === "Busy",
          schedule: Schedule.max([Schedule.spaced("250 millis"), Schedule.recurs(40)]),
        }),
        Effect.tap(() => Effect.sync(() => progress.stop("Removed Cache"))),
        Effect.catch((error) =>
          Effect.sync(() => {
            progress.stop("Failed to remove Cache", 1)
            errors.push(`Cache: ${errorMessage(error)}`)
          }),
        ),
      )
    }
    yield* Effect.forEach(shell, (file) =>
      cleanShellFile(file, shellPathCommands({ bin, fish: isFishConfig(file) })).pipe(
        Effect.catch((error) => Effect.sync(() => errors.push(`Shell config ${file}: ${errorMessage(error)}`))),
      ),
    )
    if (removal) {
      progress.start(`Running ${removal.command.join(" ")}...`)
      yield* removal.run.pipe(
        Effect.tap(() => Effect.sync(() => progress.stop("Package removed"))),
        Effect.catch((error) =>
          Effect.sync(() => {
            progress.stop("Package manager uninstall failed", 1)
            errors.push(errorMessage(error))
            log.warn(`Run manually: ${removal.command.join(" ")}`)
          }),
        ),
      )
    }
    if (ownership.owned && ownership.method === "curl") {
      log.message("To finish removing the Panacode binary, run:")
      log.info(`  rm '${ownership.binary.replaceAll("'", "'\\''")}'`)
    }
    if (errors.length) yield* Effect.fail(new Error(errors.join("\n")))
    outro("Done")
  }, handlePromptErrors),
)

const privateCache = Effect.fnUntraced(function* (fs: FileSystem.FileSystem, directory: string) {
  if (!(yield* fs.exists(directory))) return { status: "missing" as const }
  const info = yield* fs.lstat(directory).pipe(Effect.orElseSucceed(() => undefined))
  // A linked cache may be OpenCode's or a shared cache. Never delete or relocate through the alias.
  if (!info || info.type === "SymbolicLink") return { status: "unsafe" as const, path: directory }
  const resolved = yield* fs.realPath(directory).pipe(Effect.orElseSucceed(() => directory))
  if (path.basename(resolved) !== ProductIdentity.slug) return { status: "unsafe" as const, path: directory }
  return { status: "safe" as const, path: directory }
})

const shellConfigs = Effect.fnUntraced(function* (home: string, bin: string) {
  const fs = yield* FileSystem.FileSystem
  // V1, V2, and OpenCode installs can share the same bin directory. Retain its PATH entry while
  // any other binary still lives there; removing it would break the remaining product.
  if (yield* shellPathShared(bin, path.basename(process.execPath))) return []
  const files = shellConfigCandidates({ home, shell: process.env.SHELL || "bash", env: process.env })
  return yield* Effect.filter(files, (file) =>
    fs.readFileString(file).pipe(
      Effect.map(
        (content) => cleanShellConfig(content, shellPathCommands({ bin, fish: isFishConfig(file) })) !== content,
      ),
      Effect.orElseSucceed(() => false),
    ),
  )
})
