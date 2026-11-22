import { managedServiceTarget, migrateOwnedRegistration, privateFileBytes, registrationBytes, renameServiceFile, withRegistrationLock } from "@opencode/client/service"
import { Global } from "@opencode/util/global"
import { ProductIdentity } from "@opencode/util/product-identity"
import { physicalPath } from "@opencode/util/product-path"
import { OPENCODE_CHANNEL, OPENCODE_VERSION } from "../version"
import { Hash } from "@opencode/util/hash"
import { Service } from "@opencode/client/effect/service"
import { Effect, FileSystem, Option, Schema } from "effect"
import { randomBytes, randomUUID } from "node:crypto"
import { rename, rm, writeFile } from "node:fs/promises"
import path from "path"
import { selfCommand } from "../util/process"
import { RemoteTunnel } from "./remote-tunnel"

// The CLI's service configuration file, plus the Service.EnsureOptions binding that
// points the client package's service operations at this CLI: which
// registration file (by channel), which version, and how to spawn opencode.

export const Info = Schema.Struct({
  disabled: Schema.optional(Schema.Boolean),
  // Present when remote access is on. The route is generated, never user-set: the secret subdomain the service is
  // served on.
  remote: Schema.optional(Schema.Struct({ route: Schema.String })),
  // Set once the user has accepted exposing the service to the internet, or had remote access on before, so turning
  // remote access off and on again does not ask a second time.
  remoteAccepted: Schema.optional(Schema.Literal(true)),
  hostname: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(65_535))),
  password: Schema.optional(Schema.String),
  cors: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
export type Info = typeof Info.Type

const keys = ["disabled", "remote", "hostname", "port", "password", "cors", "env"] as const
type Key = (typeof keys)[number]

const decodeInfo = Schema.decodeUnknownEffect(Schema.fromJsonString(Info))
// Earlier builds stored remote access as a boolean.
const decodeLegacy = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ ...Info.fields, remote: Schema.Boolean })),
)
const decodeRegistration = Schema.decodeUnknownEffect(Schema.fromJsonString(Service.Info))

// Panacode: the Windows release workflow builds the CLI with OPENCODE_CHANNEL=prod (the desktop's release channel), so
// "prod" is a release channel like "latest". Before this, a prod CLI registered in service-prod.json while Desktop
// polled service.json, and every packaged Windows launch timed out (panacode-docs/decisions.md D-018).
export function releaseChannel(channel: string) {
  return channel === "latest" || channel === "prod" || channel === "dev" || channel === "beta" || channel === "next"
}

export function filename(channel = OPENCODE_CHANNEL) {
  if (releaseChannel(channel)) return "service.json"
  return `service-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`
}

export function defaultPort(channel = OPENCODE_CHANNEL, platform = process.platform) {
  const port = channelPort(channel)
  // Windows hands out 0xC000-0xFFFF for outgoing connections, Hyper-V and WinNAT reserve blocks of that range at boot,
  // and WSL mirrored networking reserves a 4096-port block that usually covers 44620-48715. A reserved port fails as in
  // use while nothing listens on it. Moving into the 0x7000 block, below 32768, avoids all of them and keeps the low
  // 12 bits: 0xC0AC becomes 0x70AC (28844).
  if (platform === "win32" && port >= 0x8000) return 0x7000 | (port & 0xfff)
  return port
}

// Panacode: upstream OpenCode's managed service listens on 0xC0DE (49374; 0x70DE = 28894 on Windows). Panacode keeps
// the same scheme with its own low byte so both apps can run side by side: 0xC0AC (49324) on macOS and Linux, 0x70AC
// (28844) on Windows. See panacode-docs/decisions.md D-016.
export const PANACODE_SERVICE_PORT = 0xc0ac

function channelPort(channel: string) {
  if (releaseChannel(channel)) return PANACODE_SERVICE_PORT
  if (channel === "local") return PANACODE_SERVICE_PORT + 1
  return 10_000 + (Number.parseInt(Hash.fast(channel).slice(0, 8), 16) % 50_000)
}

export function legacyFilename(channel = OPENCODE_CHANNEL) {
  if (channel === "latest" || channel === "local") return
  return `service-${Hash.fast(channel)}.json`
}

export function versionBelongsToChannel(
  version: string | undefined,
  channel = OPENCODE_CHANNEL,
  installedVersion = OPENCODE_VERSION,
) {
  if (version === undefined) return false
  if (version === installedVersion) return true
  const prefix = `0.0.0-${channel}-`
  if (!version.startsWith(prefix)) return false
  return /^\d+(?:\.\d+)?$/.test(version.slice(prefix.length))
}

const legacyText = (file: string) => Effect.tryPromise(() => registrationBytes(file)).pipe(
  Effect.map((bytes) => bytes?.toString("utf8")),
  Effect.orElseSucceed(() => undefined),
)

export const migrateRegistration = Effect.fnUntraced(function* (
  legacy: string,
  file: string,
  channel = OPENCODE_CHANNEL,
  installedVersion = OPENCODE_VERSION,
) {
  const text = yield* legacyText(legacy)
  if (!text) return
  const registration = yield* decodeRegistration(text).pipe(Effect.option)
  if (Option.isNone(registration)) return
  const info = registration.value
  // A version, filename, or location is not proof of ownership. Only a record that carries
  // Panacode's own product and instance identity may move to the live registration path; an
  // ambiguous legacy record stays where it is instead of being promoted.
  if (info.product !== "panacode" || info.id === undefined || info.password === undefined) return
  if (!versionBelongsToChannel(info.version, channel, installedVersion)) return
  yield* Effect.tryPromise(() => migrateOwnedRegistration(legacy, file, info, text)).pipe(Effect.ignore)
})

// Configuration and service registration have independent locks. Even when their XDG
// bases coincide, publishing a service can still call its configuration preparation.
function withConfigLock<T>(file: string, run: () => Promise<T>) {
  return withRegistrationLock(file + ".config", run)
}

// The old filename can hold either kind of record when the two XDG bases are the
// same physical directory. Decode only positive, unambiguous settings as configuration.
function sharedRecordKind(source: Buffer): "registration" | "config" | "ambiguous" {
  let data: unknown
  try {
    data = JSON.parse(source.toString("utf8"))
  } catch {
    return "ambiguous"
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return "ambiguous"
  const names = Object.keys(data)
  if (names.every((key) => Object.hasOwn(Info.fields, key))) {
    const text = source.toString("utf8")
    return Option.isSome(Schema.decodeUnknownOption(Info)(data)) || Option.isSome(decodeLegacy(text)) ? "config" : "ambiguous"
  }
  if (
    "url" in data && typeof data.url === "string" && URL.canParse(data.url) &&
    "pid" in data && typeof data.pid === "number" && Number.isSafeInteger(data.pid) && data.pid > 0 &&
    names.every((key) => key === "password" || !Object.hasOwn(Info.fields, key))
  ) return "registration"
  return "ambiguous"
}

// All configuration writers hold withConfigLock. A crash leaves either the old complete
// settings or the new complete settings at the public name, never a partial or linked file.
async function publishConfig(file: string, source: string | Buffer, onlyMissing: boolean) {
  const current = await privateFileBytes(file)
  if (onlyMissing && current !== undefined) return
  const temporary = file + "." + randomUUID() + ".tmp"
  await writeFile(temporary, source, { flag: "wx", mode: 0o600 })
  try {
    await renameServiceFile(temporary, file)
  } finally {
    await rm(temporary, { force: true })
  }
}

async function separateSharedConfig(oldPath: string, file: string) {
  const seen = await privateFileBytes(oldPath)
  if (!seen) return
  const kind = sharedRecordKind(seen)
  if (kind === "registration") return
  if (kind === "ambiguous")
    throw new Error("The shared XDG state and configuration directory contains an ambiguous service record. Its files were preserved. Select separate XDG_STATE_HOME and XDG_CONFIG_HOME directories.")
  await withRegistrationLock(oldPath, async () => {
    const current = await privateFileBytes(oldPath)
    if (!current?.equals(seen)) return
    await withConfigLock(file, async () => {
      // Keep newer settings and archive the complete legacy bytes before freeing the
      // registration name. Never import a password from a service registration.
      await publishConfig(file, current, true)
      await rename(oldPath, oldPath + "." + randomUUID() + ".legacy-config")
    })
  })
}

export const migrateConfig = Effect.fnUntraced(function* (legacy: string, file: string, shared = false) {
  const fs = yield* FileSystem.FileSystem
  if (yield* fs.exists(file)) return
  const source = yield* Effect.tryPromise(() => privateFileBytes(legacy)).pipe(Effect.orElseSucceed(() => undefined))
  if (!source || (shared && sharedRecordKind(source) !== "config")) return
  const text = source.toString("utf8")
  if (Option.isNone(yield* decodeInfo(text).pipe(Effect.option)) && Option.isNone(decodeLegacy(text))) return
  yield* Effect.tryPromise(() => withConfigLock(file, () => publishConfig(file, source, true)))
})

export const migrateChannelConfig = Effect.fnUntraced(function* (
  directory: string,
  channel = OPENCODE_CHANNEL,
  target = path.join(directory, filename(channel)),
) {
  const oldPath = path.join(directory, filename(channel))
  const shared = target !== oldPath
  if (shared) yield* Effect.tryPromise({ try: () => separateSharedConfig(oldPath, target), catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)) })
  const hashed = legacyFilename(channel)
  // The packaged r10 CLI used its named prod configuration in preference to the earlier hash.
  if (channel === "prod") yield* migrateConfig(path.join(directory, "service-prod.json"), target, shared)
  if (hashed) yield* migrateConfig(path.join(directory, hashed), target, shared)
})

function configKey(key: string): Key {
  if (
    key === "disabled" ||
    key === "remote" ||
    key === "hostname" ||
    key === "port" ||
    key === "password" ||
    key === "cors" ||
    key === "env"
  )
    return key
  throw new Error(`Unknown service config key: ${key}`)
}

const paths = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const global = yield* Global.Service
  const name = filename()
  const legacy = legacyFilename()
  const file = path.join(global.state, name)
  const shared = path.relative(physicalPath(global.config), physicalPath(global.state)) === ""
  return {
    fs,
    file,
    configDir: global.config,
    legacyRegistrationFiles: [
      ...(legacy ? [path.join(global.state, legacy)] : []),
      // A pre-proof r10 registration stays untouched. Only a verified service may migrate.
      ...(OPENCODE_CHANNEL === "prod" ? [path.join(global.state, "service-prod.json")] : []),
      ...(name !== "service.json" && OPENCODE_CHANNEL !== "local" ? [path.join(global.state, "service.json")] : []),
    ],
    configFile: path.join(global.config, shared ? "settings." + name : name),
  }
})

// Clients find the service at its registration under XDG_STATE_HOME. A saved value would move the
// registration away from them, and children of the service (tool shells, a relaunched Desktop) would
// look for it in the wrong place, so the service keeps the state directory it was launched with.
export function processEnv(env: Info["env"], privateProfile = process.env.PANACODE_SERVICE_COEXIST === "1") {
  if (env === undefined) return undefined
  // A saved service environment is Panacode's own. Drop upstream runtime overrides so a value
  // persisted by an older build cannot move the service back onto OpenCode's paths or credentials.
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => {
      // Windows process.env accepts all case variants. Only the spawning client can supply
      // its state root, its per-launch service key, or its verified terminal handoff.
      const name = key.toUpperCase()
      return (
        name !== "XDG_STATE_HOME" &&
        name !== "PANACODE_SERVICE_PROOF_KEY" &&
        name !== "PANACODE_SERVICE_COEXIST" &&
        !(privateProfile && (name === "XDG_DATA_HOME" || name === "PANACODE_DB")) &&
        name !== "PANACODE_PTY_HANDOFF" &&
        !name.startsWith(`${ProductIdentity.upstreamEnvPrefix}_`)
      )
    }),
  )
}

export const options = Effect.fnUntraced(function* (input: { readonly checkVersion?: boolean } = {}) {
  const { file, legacyRegistrationFiles } = yield* paths
  yield* Effect.forEach(legacyRegistrationFiles, (legacy) => migrateRegistration(legacy, file))
  const target = yield* Effect.tryPromise(() => managedServiceTarget(file))
  const configuredEnv = processEnv((yield* read()).env, !!target.env || process.env.PANACODE_SERVICE_COEXIST === "1")
  const env: Record<string, string> | undefined = target.env ? { ...configuredEnv, ...target.env } : configuredEnv
  return {
    file: target.file,
    privateProfile: target.env,
    version: input.checkVersion ? OPENCODE_VERSION : undefined,
    env,
    command: [...selfCommand(), "serve", "--service"],
  }
})

export const read = Effect.fn("cli.service-config.read")(function* () {
  const { configFile, configDir } = yield* paths
  yield* migrateChannelConfig(configDir, OPENCODE_CHANNEL, configFile)
  const bytes = yield* Effect.tryPromise(() => privateFileBytes(configFile))
  if (!bytes) return {} as Info
  const text = bytes.toString("utf8")
  const info = yield* decodeInfo(text).pipe(Effect.option)
  if (Option.isSome(info)) return info.value
  const legacy = decodeLegacy(text)
  if (Option.isNone(legacy)) return {} as Info
  // Repair the file in place so every reader sees the same route.
  const { remote: enabled, ...rest } = legacy.value
  const repaired: Info = enabled ? { ...rest, remote: { route: route() } } : rest
  yield* write(repaired)
  return repaired
})

// 64 random bits as 16 hex characters, a valid DNS label.
function route() {
  return randomBytes(8).toString("hex")
}

const write = Effect.fn("cli.service-config.write")(function* (value: Info) {
  const { fs, configFile } = yield* paths
  yield* fs.makeDirectory(path.dirname(configFile), { recursive: true })
  yield* Effect.tryPromise(() =>
    withConfigLock(configFile, () => publishConfig(configFile, JSON.stringify(value, null, 2) + "\n", false)),
  )
})

export const password = Effect.fn("cli.service-config.password")(function* (value?: string) {
  const existing = yield* read()
  if (value === undefined && existing.password) return existing.password
  const next = value ?? randomBytes(32).toString("base64url")

  // Keep one private credential across server restarts so discovered clients
  // can reconnect without exposing a password flag or environment variable.
  yield* write({ ...existing, password: next })
  return next
})

export const acceptRemote = Effect.fn("cli.service-config.accept-remote")(function* () {
  yield* write({ ...(yield* read()), remoteAccepted: true })
})

// Disabling forgets the address, so enabling again issues a new unguessable one. Having had it on counts as
// accepting remote access.
const disableRemote = Effect.fnUntraced(function* () {
  const { remote, ...next } = yield* read()
  yield* write(remote === undefined ? next : { ...next, remoteAccepted: true })
})

// Turns remote access on and returns its route, created once and kept so the remote URL survives restarts.
export const remote = Effect.fn("cli.service-config.remote")(function* () {
  const existing = yield* read()
  if (existing.remote) return existing.remote.route
  const next = route()
  yield* write({ ...existing, remote: { route: next } })
  return next
})

export const get = Effect.fn("cli.service-config.get")(function* (key?: string, name?: string) {
  if (key === undefined) {
    const { password: _password, ...safe } = yield* read()
    // The route is as sensitive as the password: it is the unguessable half of the remote address.
    return JSON.stringify(safe.remote === undefined ? safe : { ...safe, remote: {} }, null, 2)
  }
  const selected = configKey(key)
  if (selected !== "env" && name !== undefined) throw new Error(`Usage: panacode service get ${selected}`)
  switch (selected) {
    case "disabled": {
      return String((yield* read()).disabled ?? false)
    }
    case "remote": {
      return String((yield* read()).remote !== undefined)
    }
    case "hostname": {
      return (yield* read()).hostname ?? ""
    }
    case "port": {
      const port = (yield* read()).port
      return port === undefined ? "" : String(port)
    }
    case "password": {
      const target = yield* options()
      if (target.privateProfile || process.env.PANACODE_SERVICE_COEXIST === "1") {
        const info = yield* Service.verifiedRegistration(target)
        if (info?.password) return info.password
      }
      return yield* password()
    }
    case "cors": {
      return JSON.stringify((yield* read()).cors ?? [], null, 2)
    }
    case "env": {
      const env = (yield* read()).env ?? {}
      return name === undefined ? JSON.stringify(env, null, 2) : (env[name] ?? "")
    }
  }
  throw new Error(`Unknown service config key: ${key}`)
})

export const set = Effect.fn("cli.service-config.set")(function* (key: string, value: string, nestedValue?: string) {
  const selected = configKey(key)
  if (selected !== "env" && nestedValue !== undefined)
    throw new Error(`Usage: panacode service set ${selected} <value>`)
  switch (selected) {
    case "disabled": {
      if (value !== "true" && value !== "false") throw new Error("Disabled must be true or false")
      if (value === "true") yield* Service.stop(yield* options())
      yield* write({ ...(yield* read()), disabled: value === "true" })
      return
    }
    case "remote": {
      if (value !== "true" && value !== "false") throw new Error("Remote must be true or false")
      // A tunnel that cannot be created leaves remote access off instead of a service that keeps retrying.
      if (value === "true") yield* RemoteTunnel.ensure()
      yield* Service.stop(yield* options())
      if (value === "true") {
        yield* remote()
        return
      }
      yield* disableRemote()
      return
    }
    case "hostname": {
      yield* Service.stop(yield* options())
      yield* write({ ...(yield* read()), hostname: value })
      return
    }
    case "port": {
      const port = Number(value)
      if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Port must be between 1 and 65535")
      yield* Service.stop(yield* options())
      yield* write({ ...(yield* read()), port })
      return
    }
    case "password": {
      yield* Service.stop(yield* options())
      yield* password(value)
      return
    }
    case "env": {
      if (nestedValue === undefined) throw new Error("Usage: panacode service set env <key> <value>")
      yield* Service.stop(yield* options())
      const existing = yield* read()
      yield* write({ ...existing, env: { ...existing.env, [value]: nestedValue } })
      return
    }
    case "cors": {
      const cors = value.split(",").map((origin) => origin.trim())
      if (
        cors.some((origin) => {
          const url = URL.parse(origin)
          return !url || (url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== origin
        })
      )
        throw new Error("CORS must be a comma-separated list of HTTP(S) origins without paths or trailing slashes")
      yield* Service.stop(yield* options())
      yield* write({ ...(yield* read()), cors })
      return
    }
  }
})

export const unset = Effect.fn("cli.service-config.unset")(function* (key: string, name?: string) {
  const selected = configKey(key)
  if (selected !== "env" && name !== undefined) throw new Error(`Usage: panacode service unset ${selected}`)
  switch (selected) {
    case "disabled": {
      const { disabled: _disabled, ...next } = yield* read()
      yield* write(next)
      return
    }
    case "remote": {
      yield* Service.stop(yield* options())
      yield* disableRemote()
      return
    }
    case "hostname": {
      yield* Service.stop(yield* options())
      const { hostname: _hostname, ...next } = yield* read()
      yield* write(next)
      return
    }
    case "port": {
      yield* Service.stop(yield* options())
      const { port: _port, ...next } = yield* read()
      yield* write(next)
      return
    }
    case "password": {
      yield* Service.stop(yield* options())
      const { password: _password, ...next } = yield* read()
      yield* write(next)
      return
    }
    case "env": {
      if (name === undefined) throw new Error("Usage: panacode service unset env <key>")
      yield* Service.stop(yield* options())
      const existing = yield* read()
      const { [name]: _removed, ...env } = existing.env ?? {}
      const { env: _existingEnv, ...rest } = existing
      yield* write(Object.keys(env).length === 0 ? rest : { ...rest, env })
      return
    }
    case "cors": {
      yield* Service.stop(yield* options())
      const { cors: _cors, ...next } = yield* read()
      yield* write(next)
      return
    }
  }
})

export * as ServiceConfig from "./service-config"
