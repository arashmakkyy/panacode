import { Effect, Option, Schema } from "effect"
import { HttpClient } from "effect/http"
import { ManagedCli } from "../managed-cli"
import { parseTarget, quote, runSsh, sshArgs, SshFailure } from "./command"
import { RemoteCli } from "./remote-cli"

// The registration is the service's complete private discovery contract; no remote
// Python/Node runtime is needed. It is read only through a CLI whose sidecar and digest
// were verified, so an unrelated executable cannot answer for Panacode.
const registrationScript = `status=$("$cli" service status) || exit 0
if [ "$status" = stopped ]; then exit 0; fi
printf 'OPENCODE_SSH_STATUS=%s\\n' "$status"
for file in "\${XDG_STATE_HOME:-$HOME/.local/state}"/panacode/service*.json; do
  if [ ! -f "$file" ]; then continue; fi
  printf 'OPENCODE_SSH_REGISTRATION_BEGIN\\n'
  cat "$file"
  printf '\\nOPENCODE_SSH_REGISTRATION_END\\n'
done
`

export function discoverScript(input: { version: string; target: string }) {
  return `set -eu
${RemoteCli.discoverScript(input)}
if [ -z "$cli" ]; then exit 0; fi
${registrationScript}`
}

export function startScript(input: { version: string; replace?: boolean }) {
  return `set -eu
cli="${binaryPath(input.version)}"
"$cli" service ${input.replace ? "restart" : "start"}
${registrationScript}`
}

const Registration = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.NonEmptyString,
    product: Schema.Literal("panacode"),
    url: Schema.String,
    password: Schema.String,
    version: Schema.String,
    pid: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
)

export function parseRegistration(output: string) {
  const status = output
    .split(/\r?\n/)
    .findLast((line) => line.startsWith("OPENCODE_SSH_STATUS="))
    ?.slice("OPENCODE_SSH_STATUS=".length)

  if (!status) return undefined

  for (const match of output.matchAll(
    /OPENCODE_SSH_REGISTRATION_BEGIN\r?\n([\s\S]*?)\r?\nOPENCODE_SSH_REGISTRATION_END/g,
  )) {
    const result = Schema.decodeUnknownOption(Registration)(match[1])

    if (Option.isSome(result) && result.value.url === status) return result.value
  }

  return undefined
}

function cachedCli(output: string) {
  return output.split(/\r?\n/).includes("OPENCODE_SSH_CLI=ready")
}

export function binaryPath(version: string) {
  return `$HOME/.panacode/desktop-ssh/${RemoteCli.requireVersion(version)}/panacode`
}

function connectionAddress(address: string, password: string, instance: string) {
  const url = new URL(address)

  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "0.0.0.0", "[::]", "[::1]"].includes(url.hostname))
    throw new SshFailure("service")

  return {
    host: url.hostname === "[::1]" ? "[::1]" : "127.0.0.1",
    port: Number(url.port || 80),
    password,
    instance,
  }
}

export const bootstrap = Effect.fn("Ssh.bootstrap")(function* (input: {
  target: ReturnType<typeof parseTarget>
  version: string
  development?: boolean
  env: NodeJS.ProcessEnv
  replace?: boolean
}) {
  const run = (script: string) =>
    runSsh({
      args: [...sshArgs(input.target), input.target.host, "sh -l -s"],
      env: input.env,
      stdin: script,
    })

  // Probe before discovery: the cache and every install decision belong to the
  // remote OS and CPU, never to this Windows host.
  const probe = yield* run(RemoteCli.probeScript).pipe(Effect.mapError(() => new SshFailure("platform")))

  const reported = probe
    .split(/\r?\n/)
    .findLast((line) => line.startsWith("OPENCODE_REMOTE_TARGET="))
    ?.slice("OPENCODE_REMOTE_TARGET=".length)

  const target = yield* Effect.try({
    try: () => ManagedCli.requireTarget(reported ?? ""),
    catch: () => new SshFailure("platform"),
  })

  const discovery = yield* run(discoverScript({ version: input.version, target }))
  const registered = parseRegistration(discovery)
  const cached = cachedCli(discovery)

  if (registered && (input.development || registered.version === input.version))
    return yield* Effect.try({
      try: () => connectionAddress(registered.url, registered.password, registered.id),
      catch: SshFailure.from,
    })

  if (registered && !input.replace) return yield* Effect.fail(new SshFailure("version", registered.version))

  if (!cached) {
    const artifact = yield* RemoteCli.artifact(target, input.version).pipe(Effect.mapError(SshFailure.from))

    const install = yield* Effect.try({
      try: () => RemoteCli.installScript({ version: input.version, source: { type: "download", artifact } }),
      catch: SshFailure.from,
    })

    yield* run(install).pipe(
      Effect.catch(
        Effect.fnUntraced(function* (error) {
          const http = yield* HttpClient.HttpClient

          const response = yield* http
            .get(artifact.url)
            .pipe(Effect.mapError(() => new SshFailure("install", error.message)))

          if (response.status < 200 || response.status >= 300)
            return yield* Effect.fail(
              new SshFailure("install", JSON.stringify({ url: artifact.url, status: response.status })),
            )

          const archive = new Uint8Array(
            yield* response.arrayBuffer.pipe(Effect.mapError(() => new SshFailure("install", error.message))),
          )

          if (ManagedCli.sha512Hex(archive) !== artifact.sha512)
            return yield* Effect.fail(new SshFailure("install", `The ${artifact.package} archive failed its digest check.`))

          // The upload uses stdin; the script itself must be the remote command.
          const command = yield* Effect.try({
            try: () =>
              `sh -c ${quote(
                RemoteCli.installScript({
                  version: input.version,
                  source: { type: "archive", artifact, sha256: ManagedCli.sha256Hex(archive) },
                }),
              )}`,
            catch: SshFailure.from,
          })

          return yield* runSsh({
            args: [...sshArgs(input.target), input.target.host, command],
            env: input.env,
            stdin: archive,
          }).pipe(Effect.mapError(() => new SshFailure("install", error.message)))
        }),
      ),
    )
  }

  const start = yield* Effect.try({
    try: () => startScript({ version: input.version, replace: input.replace }),
    catch: SshFailure.from,
  })

  const registration = parseRegistration(yield* run(start))

  if (!registration) return yield* Effect.fail(new SshFailure("service"))

  if (!input.development && registration.version !== input.version)
    return yield* Effect.fail(new SshFailure("version", registration.version))

  return yield* Effect.try({
    try: () => connectionAddress(registration.url, registration.password, registration.id),
    catch: SshFailure.from,
  })
})