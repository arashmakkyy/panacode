import { app } from "electron"
import type { Endpoint, EnsureDiagnostic } from "@opencode/client/service"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { SidecarChanged } from "../../shared/ipc-rpc/events"
import { CHANNEL } from "../constants"
import { emitIpcEvent } from "../ipc-events"
import { getMainWindows } from "../windows"
import { BackgroundServiceMachine } from "./background-service-machine"
import { cleanStages } from "./cli-stages"
import { keptStages, serviceVersion, shouldRetryEnsure } from "./cli-version"
import { DesktopCli } from "./desktop-cli"
import { SidecarCredentials } from "./sidecar-credentials"
import { takeSidecarProbe } from "./sidecar-probe"
import { withEnsureTiming } from "@opencode/client/service"
import { serviceRegistration } from "./cli-service-file"
import { resolveStateRoot } from "./state-root"

export * as BackgroundService from "./background-service"

const RegisteredService = Schema.Struct({ version: Schema.optional(Schema.String) })

export interface Interface {
  readonly connection: Effect.Effect<SidecarCredentials.Data>
  readonly reconnect: Effect.Effect<SidecarCredentials.Data>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/BackgroundService") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const context = yield* Effect.context<FileSystem.FileSystem | Path.Path | DesktopCli.Service>()

    return Service.of(
      yield* BackgroundServiceMachine.make({
        probe: probe().pipe(Effect.provide(context)),
        ensure: (mode) => ensure(mode).pipe(Effect.provide(context)),
        publish: (data) => {
          SidecarCredentials.set(data)
          // Every window moves its requests and event stream to the new origin, not only the one that reconnected.
          const event = new SidecarChanged({ url: data.url })
          getMainWindows().forEach((win) => emitIpcEvent(win.webContents, event))
        },
      }),
    )
  }),
)

// A compatible service the entry module already found is adopted at once; the machine still verifies it with
// `ensure("initial")` (which also completes a terminal handoff), off the renderer's path.
const probe = Effect.fn("BackgroundService.probe")(function* () {
  const setup = yield* prepare("initial")
  const result = yield* Effect.promise(() => takeSidecarProbe(setup.key))

  if (result.status === "discarded") {
    yield* Effect.logWarning("discarding speculative v2 CLI service probe", { reason: result.reason })
    return undefined
  }
  if (result.status === "miss") return undefined

  return (yield* adopt(setup, result.endpoint, true)).credentials
})

const ensure = Effect.fn("BackgroundService.ensure")(function* (mode: BackgroundServiceMachine.ConnectMode) {
  const runFork = Effect.runForkWith(yield* Effect.context<FileSystem.FileSystem | Path.Path>())
  const setup = yield* prepare(mode)
  // Windows antivirus + Hyper-V excluded ports often make the first boot exceed the client's 2s
  // health probe; the ensure loop then kills a still-starting server. Use a safer port, longer
  // probes, and skip the models.dev fetch so packaged Windows reaches /api/info ready in time.
  const windowsPackaged = app.isPackaged && process.platform === "win32"

  const run = (version = setup.version) => {
    const options = {
      file: setup.file,
      version,
      // The CLI owns port precedence: a saved `panacode service set port` wins over its channel
      // default, and the managed service must never ask for port 0 or a random port. A fixed port
      // also makes a second contender fail to bind and back off instead of booting a second writer
      // against the same database.
      command: [
        ...setup.cli.command,
        "serve",
        "--service",
        ...(setup.isolated || windowsPackaged ? ["--hostname", "127.0.0.1"] : []),
      ],
      env: windowsPackaged
        ? {
            PANACODE_DISABLE_MODELS_FETCH: "1",
            PANACODE_DISABLE_FILEWATCHER: "1",
          }
        : undefined,
      onStart: (reason: "missing" | "version-mismatch", previousVersion?: string) =>
        runFork(Effect.logInfo("v2 CLI background service starting", { reason, previousVersion })),
      onDiagnostic: (diagnostic: EnsureDiagnostic) =>
        runFork(Effect.logInfo("v2 CLI background service boot", diagnostic)),
    }
    return setup.client.Service.ensure(
      windowsPackaged
        ? withEnsureTiming(options, {
            requestTimeout: 15_000,
            promiseTimeout: 240_000,
            spawnDelay: 15_000,
            maxSpawnDelay: 60_000,
          })
        : options,
    )
  }

  const service = yield* Effect.tryPromise(() =>
    run().catch((error) => {
      if (!shouldRetryEnsure(setup.version, error instanceof Error ? error.message : String(error))) throw error

      return run(setup.cli.version)
    }),
  )

  const ready = yield* adopt(setup, service, false)

  // Only packaged and isolated builds run a staged copy; any other binary sits in the source tree.
  // Keep both the bundled stage and the running server's stage so its executable stays on disk. This runs only
  // once `Service.ensure` settled which server runs, never for a probed one it may still replace.
  if (mode === "initial" && (app.isPackaged || setup.isolated) && setup.cli.binary && ready.runningVersion)
    runFork(
      cleanStages(setup.cli.binary, { keep: keptStages(setup.cli.version, ready.runningVersion) }).pipe(
        Effect.catch((error) => Effect.logError("failed to clean staged v2 CLIs", { error })),
      ),
    )

  return ready.credentials
})

const prepare = Effect.fn("BackgroundService.prepare")(function* (mode: BackgroundServiceMachine.ConnectMode) {
  yield* Effect.logInfo("starting v2 background service")
  const path = yield* Path.Path
  const desktopCli = yield* DesktopCli.Service
  const isolated = !app.isPackaged && process.env.PANACODE_DESKTOP_ISOLATED_SERVER === "1"
  const home = app.getPath("home")
  const stateRoot = resolveStateRoot({
    home,
    inherited: process.env.XDG_STATE_HOME,
    isolatedRoot: isolated ? app.getPath("userData") : undefined,
  })
  // The CLI and every process this desktop spawns must resolve the same state directory. Writing
  // the effective value also replaces a relative inherited value, which neither side may honor.
  process.env.XDG_STATE_HOME = stateRoot

  const cli = yield* desktopCli.resolve
  const local = process.env.PANACODE_DESKTOP_SERVER_CHANNEL === "local"
  const version = serviceVersion({ channel: CHANNEL, isolated, mode, version: cli.version })
  const registration = serviceRegistration({
    join: path.join,
    home,
    cliVersion: cli.version,
    stateHome: stateRoot,
    local,
  })
  const client = yield* Effect.promise(() => import("@opencode/client/service"))

  yield* Effect.logInfo("v2 CLI service registration", {
    channel: CHANNEL,
    filename: path.basename(registration.file),
    stateRoot: path.basename(registration.stateRoot),
    cliVersion: cli.version,
    isolated,
  })

  return {
    cli,
    client,
    file: registration.file,
    isolated,
    local,
    stateRoot: registration.stateRoot,
    version,
    key: {
      stateRoot: registration.stateRoot,
      file: registration.file,
      version,
      local,
    },
  }
})

const adopt = Effect.fn("BackgroundService.adopt")(function* (
  setup: Effect.Success<ReturnType<typeof prepare>>,
  service: Endpoint,
  probed: boolean,
) {
  const fs = yield* FileSystem.FileSystem

  if (service.auth?.type !== "basic") throw new Error("V2 CLI background service did not provide authentication")
  const url = new URL(service.url)

  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1"

  const runningVersion = yield* fs.readFileString(setup.file ?? setup.client.fallback()).pipe(
    Effect.map(
      (text) =>
        Option.getOrUndefined(Schema.decodeUnknownOption(Schema.fromJsonString(RegisteredService))(text))?.version,
    ),
    Effect.orElseSucceed(() => undefined),
  )

  yield* Effect.logInfo("v2 CLI background service ready", {
    version: setup.version,
    runningVersion,
    probed,
    ...endpoint(url.origin),
  })

  return {
    credentials: { url: url.origin, password: service.auth.password } satisfies SidecarCredentials.Data,
    runningVersion,
  }
})

function endpoint(url: string | undefined) {
  if (!url || !URL.canParse(url)) return {}
  const parsed = new URL(url)

  return { url, hostname: parsed.hostname, port: parsed.port }
}
