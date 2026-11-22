export * as ServiceRegistration from "./service-registration"

import { Service, type Info } from "@opencode/client/effect/service"
import { privateDirectory } from "@opencode/util/private-directory"
import { publishRegistration, type TerminalAction } from "@opencode/client/service"
import path from "node:path"
import { Effect, FileSystem, Schedule, Schema } from "effect"
import { HttpServer } from "effect/http"
import { NetAddress } from "effect/net"
import { OPENCODE_VERSION } from "../version"
import { ServiceControl } from "./service-control"

const infoJson = Schema.fromJsonString(Service.Info)
const encodeInfo = Schema.encodeEffect(infoJson)
const decodeInfo = Schema.decodeUnknownEffect(infoJson)

export const register = Effect.fnUntraced(function* (options: {
  readonly address: NetAddress.SocketAddress
  readonly password: string
  readonly controlToken: string
  readonly expectedRegistration?: string
  readonly terminals?: (action: TerminalAction) => Promise<unknown>
  readonly id: string
  readonly file: string
  readonly shutdown: Effect.Effect<void>
}) {
  const fs = yield* FileSystem.FileSystem
  yield* Effect.try(() => privateDirectory(path.dirname(options.file), true))
  const identity = {
    id: options.id,
    product: "panacode" as const,
    version: OPENCODE_VERSION,
    url: HttpServer.formatAddress(options.address),
    pid: process.pid,
    password: options.password,
  }
  const control = yield* ServiceControl.start({
    file: options.file,
    identity,
    token: options.controlToken,
    terminals: options.terminals,
    shutdown: options.shutdown,
  })
  yield* Effect.addFinalizer(() => control.close)
  const info = { ...identity, control: control.control }
  const encoded = yield* encodeInfo(info)
  const current = fs.readFileString(options.file).pipe(Effect.flatMap(decodeInfo))
  const owns = (found: Info) =>
    found.product === info.product &&
    found.id === info.id &&
    found.version === info.version &&
    found.url === info.url &&
    found.pid === info.pid &&
    found.password === info.password &&
    found.control?.path === info.control.path &&
    found.control?.token === info.control.token
  yield* Effect.tryPromise(() => publishRegistration(options.file, encoded, options.expectedRegistration))
  yield* current.pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("managed service registration check failed; shutting down", {
        cause,
        serviceID: options.id,
        servicePID: process.pid,
        registration: options.file,
      }).pipe(Effect.andThen(Effect.failCause(cause))),
    ),
    Effect.tap((found) =>
      owns(found)
        ? Effect.void
        : Effect.logWarning("managed service registration replaced; shutting down", {
            serviceID: options.id,
            servicePID: process.pid,
            registration: options.file,
            observedServiceID: found.id,
            observedServicePID: found.pid,
            observedVersion: found.version,
            observedURL: found.url,
          }),
    ),
    Effect.filterOrFail(owns),
    Effect.repeat(Schedule.spaced("5 seconds")),
    Effect.ignore,
    Effect.andThen(options.shutdown),
    Effect.forkScoped,
  )
  return Effect.tryPromise(() => Service.removeOwned(options.file, info)).pipe(
    Effect.andThen(control.close),
    Effect.ignore,
  )
})
