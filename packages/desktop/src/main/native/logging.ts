import { privateDirectory } from "@opencode/util/private-directory"
export * as DesktopLogging from "./logging"

import log from "electron-log/main.js"
import { app, crashReporter, netLog, shell } from "electron"
import {
  Cause,
  Context,
  Effect,
  Exit,
  FiberSet,
  Layer,
  Logger,
  Path,
  Predicate,
  References,
} from "effect"
import { CHANNEL, VERSION } from "../constants"
import { marks } from "../lifecycle/marks"
import {
  EXPORT_ARCHIVE_TIMEOUT_MS,
  initialLoggingState,
  NETLOG_TIMEOUT_MS,
  transitionLogging,
  type ExportReply,
  type LoggingCommand,
  type LoggingEvent,
} from "./logging-machine"
import {
  cleanupRunDirectories,
  createRunDirectory,
  configureDiagnostics,
  recordDiagnostic,
  writeSupportArchive,
} from "./support-archive"

const NET_LOG_SIZE = 20 * 1024 * 1024

let root = ""

let run = ""

export interface Interface {
  readonly startNetwork: Effect.Effect<void>
  readonly startCrashReporter: Effect.Effect<void>
  readonly exportDebug: Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/DesktopLogging") {}

const serviceLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const path = yield* Path.Path
    yield* initLogging(path).pipe(Effect.orDie)
    configureDiagnostics(path.join(run, "diagnostics.jsonl"))
    recordDiagnostic({ event: "app.start", version: VERSION, channel: CHANNEL, status: "started" })
    // Old run directories go away in the background; listing them is not worth a wait at startup.
    yield* Effect.forkScoped(
      Effect.tryPromise(() => cleanupRunDirectories(root)).pipe(Effect.catch(() => Effect.void)),
    )
    marks.logging = Date.now()
    yield* Effect.logInfo("app starting", {
      version: VERSION,
      packaged: app.isPackaged,
      onboardingTest: process.env.PANACODE_TEST_ONBOARDING === "1",
      marks,
    })
    const fibers = yield* FiberSet.make()
    const runFiber = yield* FiberSet.runtime(fibers)()
    const current = { state: initialLoggingState() }

    const dispatch = (event: LoggingEvent) => {
      const next = transitionLogging(current.state, event)
      current.state = next.state
      next.commands.forEach(perform)
    }

    // Every exit, defects included, reports back as an event. An interrupt only happens on disposal, which the
    // machine already left.
    const report = (
      effect: Effect.Effect<LoggingEvent, unknown>,
      failed: (error: Error) => Effect.Effect<LoggingEvent>,
    ) =>
      void runFiber(
        effect.pipe(
          Effect.exit,
          Effect.flatMap((exit) => {
            if (Exit.isSuccess(exit)) return Effect.sync(() => dispatch(exit.value))

            if (Cause.hasInterruptsOnly(exit.cause)) return Effect.void

            const error = Cause.squash(exit.cause)

            return failed(error instanceof Error ? error : new Error(String(error))).pipe(
              Effect.flatMap((event) => Effect.sync(() => dispatch(event))),
            )
          }),
        ),
      )

    const perform = (command: LoggingCommand) => {
      if (command.type === "start-netlog") {
        const attempt = command.attempt

        return report(
          Effect.suspend(() => {
            const target = path.join(run, "network.netlog")

            if (netLog.currentlyLogging) return Effect.succeed(target)

            return Effect.tryPromise(() =>
              netLog.startLogging(target, { captureMode: "default", maxFileSize: NET_LOG_SIZE }),
            ).pipe(Effect.as(target))
          }).pipe(
            Effect.timeoutOrElse({
              duration: NETLOG_TIMEOUT_MS,
              orElse: () => Effect.fail(new Error("net log timed out")),
            }),
            Effect.tap((target) => scoped("network", Effect.logInfo("net log started", { path: target }))),
            Effect.map((target): LoggingEvent => ({ type: "netlog.started", attempt, path: target })),
          ),
          (error) =>
            scoped("network", Effect.logWarning(`failed to ${command.mode} net log`, { error })).pipe(
              Effect.map((): LoggingEvent => ({ type: "netlog.start-failed", attempt })),
            ),
        )
      }

      if (command.type === "stop-netlog") {
        const attempt = command.attempt

        return report(
          Effect.suspend(() =>
            netLog.currentlyLogging ? Effect.tryPromise(() => netLog.stopLogging()) : Effect.void,
          ).pipe(
            Effect.timeoutOrElse({
              duration: NETLOG_TIMEOUT_MS,
              orElse: () => Effect.fail(new Error("net log timed out")),
            }),
            Effect.map((): LoggingEvent => ({ type: "netlog.stopped", attempt })),
          ),
          (error) =>
            scoped("network", Effect.logWarning("failed to stop net log", { error })).pipe(
              Effect.map((): LoggingEvent => ({ type: "netlog.stopped", attempt })),
            ),
        )
      }

      if (command.type === "write-archive") {
        const attempt = command.attempt

        return report(
          writeDebugArchive(path, command.netLogPath).pipe(
            Effect.timeoutOrElse({
              duration: EXPORT_ARCHIVE_TIMEOUT_MS,
              orElse: () => Effect.fail(new Error("Debug log export timed out")),
            }),
            Effect.map((output): LoggingEvent => ({ type: "archive.succeeded", attempt, output })),
          ),
          (error) =>
            Effect.logError("failed to export debug logs", { error }).pipe(
              Effect.map((): LoggingEvent => ({ type: "archive.failed", attempt, error })),
            ),
        )
      }

      if (command.type === "resolve-export") return command.replies.forEach((reply) => reply.resolve(command.output))

      command.replies.forEach((reply) => reply.reject(command.error))
    }

    yield* Effect.addFinalizer(() => Effect.sync(() => dispatch({ type: "disposed" })))

    return Service.of({
      startNetwork: Effect.sync(() => dispatch({ type: "network.requested" })),
      // Starting crashpad spawns its handler process, ~60 ms on the main thread, so the first window
      // and its IPC port come first.
      startCrashReporter: initCrashReporter(path).pipe(
        Effect.tap(() => Effect.sync(() => (marks.crash = Date.now()))),
        Effect.catch((error) => Effect.logWarning("failed to start crash reporter", { error })),
      ),
      // A second export while one runs (another window, a retry after the error page gave up) joins it.
      exportDebug: Effect.callback<string>((resume) => {
        const reply: ExportReply = {
          resolve: (output) => resume(Effect.succeed(output)),
          reject: (error) => resume(Effect.die(error)),
        }

        dispatch({ type: "export.requested", reply })

        return Effect.sync(() => dispatch({ type: "export.cancelled", reply }))
      }),
    })
  }),
)

const nativeLogger = Logger.make((options) => {
  try {
    if (!run) return
    const entry = Logger.formatStructured.log(options)
    const scope = Predicate.isString(entry.annotations.scope) ? entry.annotations.scope : "main"
    const annotations = Object.fromEntries(Object.entries(entry.annotations).filter(([key]) => key !== "scope"))

    const context = Object.fromEntries(
      Object.entries({
        annotations: Object.keys(annotations).length === 0 ? undefined : annotations,
        spans: Object.keys(entry.spans).length === 0 ? undefined : entry.spans,
        cause: entry.cause,
      }).filter(([, value]) => value !== undefined),
    )

    const messages = Array.isArray(options.message) ? options.message : [options.message]
    log
      .scope(safeLogName(scope))
      [methods[options.logLevel]](...messages, ...(Object.keys(context).length === 0 ? [] : [context]))
  } catch {
    // Logging must not interrupt application work.
  }
})

const methods = {
  All: "silly",
  Trace: "silly",
  Debug: "debug",
  Info: "info",
  Warn: "warn",
  Error: "error",
  Fatal: "error",
  None: "silly",
} as const

const nativeLoggerLayer = Layer.merge(
  Logger.layer([nativeLogger], { mergeWithExisting: false }),
  Layer.succeed(References.MinimumLogLevel, "All"),
)

export const layer = serviceLayer.pipe(Layer.provideMerge(nativeLoggerLayer))

function initLogging(path: Path.Path) {
  return Effect.gen(function* () {
    root = path.join(app.getPath("userData"), "logs")
    run = yield* Effect.tryPromise(() => createRunDirectory(root, stamp()))
    yield* Effect.sync(() => {
      log.transports.file.maxSize = 5 * 1024 * 1024
      log.transports.file.resolvePathFn = (_vars, message) =>
        path.join(
          run,
          `${safeLogName(message?.scope ?? (message?.variables?.processType === "renderer" ? "renderer" : "main"))}.log`,
        )
      log.initialize({ preload: false, spyRendererConsole: true })
      initConsoleTransport()
    })
  })
}

function initCrashReporter(path: Path.Path) {
  return Effect.gen(function* () {
    const dir = path.join(app.getPath("userData"), "Crashpad")
    yield* Effect.try(() => privateDirectory(dir, true))
    yield* Effect.sync(() => {
      app.setPath("crashDumps", dir)
      crashReporter.start({ uploadToServer: false, compress: true })
    })
    yield* scoped("crash", Effect.logInfo("crash reporter started", { path: dir }))
  })
}

function writeDebugArchive(path: Path.Path, netLogPath: string | undefined) {
  return Effect.gen(function* () {
    const output = path.join(app.getPath("downloads"), `panacode-debug-${archiveStamp()}.zip`)
    yield* Effect.logInfo("exporting debug logs", { output })

    yield* Effect.tryPromise(() =>
      writeSupportArchive({
        output,
        run,
        version: VERSION,
        channel: CHANNEL,
        packaged: app.isPackaged,
        netLog: netLogPath ? "excluded" : "not-running",
      }),
    )
    yield* Effect.sync(() => shell.showItemInFolder(output))

    return output
  })
}

function stamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "")
}

function archiveStamp() {
  return new Date().toISOString().replace(/[-:.]/g, "")
}

function safeLogName(name: string) {
  return name.replace(/[^a-z0-9_.-]/gi, "_") || "main"
}

function initConsoleTransport() {
  if (app.isPackaged) {
    log.transports.console.level = false

    return
  }

  const writeConsole = log.transports.console.writeFn.bind(log.transports.console)
  log.transports.console.writeFn = (options) => {
    try {
      writeConsole(options)
    } catch (err) {
      if (!isBrokenPipe(err)) throw err
      log.transports.console.level = false
    }
  }
}

function isBrokenPipe(cause: unknown) {
  return Predicate.hasProperty(cause, "code") && cause.code === "EPIPE"
}

export function scoped(name: string, effect: Effect.Effect<void>) {
  return effect.pipe(Effect.annotateLogs("scope", name))
}
