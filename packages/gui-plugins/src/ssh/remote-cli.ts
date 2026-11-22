export * as RemoteCli from "./remote-cli"

import { Effect, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { beginInstall, cachePaths, publishGeneration, selectGeneration } from "../remote-cache"
import { ManagedCli } from "../managed-cli"

export class Failure extends Schema.TaggedError<Failure>()("RemoteCliFailure", {
  code: Schema.Literals(["platform", "version", "install", "unpublished"]),
  detail: Schema.String,
}) {
  override get message() {
    return this.detail
  }

  static from(this: void, cause: unknown) {
    return cause instanceof Failure
      ? cause
      : new Failure({ code: "install", detail: cause instanceof Error ? cause.message : String(cause) })
  }
}

export function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function requireVersion(version: string) {
  if (!ManagedCli.validVersion(version)) throw new Failure({ code: "version", detail: version })

  return version
}

const digest = `sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else return 1; fi
}
sha512_of() {
  if command -v sha512sum >/dev/null 2>&1; then sha512sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 512 "$1" | awk '{print $1}'
  else return 1; fi
}
`

export function discoverScript(input: { version: string; target: string }) {
  const version = requireVersion(input.version)
  const target = ManagedCli.requireTarget(input.target)
  return `${digest}${cachePaths("ssh", version)}${selectGeneration(version, target)}
if [ -n "$cli" ]; then printf 'OPENCODE_SSH_CLI=ready\\n'; fi
`
}

// Adapters supply a quoted shell expression, including remote HOME or wslpath expansion.
export function versionScript(command: string) {
  return `if [ -f ${command} ]; then ${command} --version 2>/dev/null || true; fi\n`
}

export function parseVersion(output: string) {
  const line = output
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim()

  if (!line) return null
  const marker = line.lastIndexOf(" v")
  const version = marker === -1 ? line : line.slice(marker + 2)

  if (!version) throw new Error("V2 CLI did not provide a version")

  return version
}

export const probeScript = `set -eu
os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$os" in linux|darwin) ;; *) exit 2 ;; esac
case "$arch" in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) exit 2 ;; esac
target="$os-$arch"
if [ "$arch" = x64 ]; then target="$target-baseline"; fi
if [ "$os" = linux ]; then
  if [ -f /etc/alpine-release ] || (ldd --version 2>&1 | grep -qi musl); then target="$target-musl"; fi
fi
printf 'OPENCODE_REMOTE_TARGET=%s\\n' "$target"
`

type Source =
  | { readonly type: "download"; readonly artifact: ManagedCli.Artifact }
  | { readonly type: "archive"; readonly artifact: ManagedCli.Artifact; readonly sha256: string }

/**
 * Installs one verified CLI into the private SSH cache. Download verifies the
 * registry sha512; relay verifies the sha256 of the bytes on stdin. Both stage
 * outside the destination and replace it atomically.
 */
export function installScript(input: { version: string; source: Source }) {
  const version = requireVersion(input.version)

  if (input.source.artifact.version !== version)
    throw new Failure({ code: "version", detail: input.source.artifact.version })
  const target = ManagedCli.requireTarget(input.source.artifact.target)

  const source =
    input.source.type === "download"
      ? `archive="$stage/archive.tgz"
url=${quote(input.source.artifact.url)}
if command -v curl >/dev/null 2>&1; then
  curl -fsSL --connect-timeout 15 --max-time 300 "$url" -o "$archive"
else
  wget -T 300 -O "$archive" "$url"
fi
test -s "$archive"
actual=$(sha512_of "$archive") || { echo "Could not hash the Panacode CLI archive." >&2; exit 1; }
test "$actual" = ${quote(input.source.artifact.sha512)}`
      : `archive="$stage/archive.tgz"
cat > "$archive"
test -s "$archive"
actual=$(sha256_of "$archive") || { echo "Could not hash the Panacode CLI archive." >&2; exit 1; }
test "$actual" = ${quote(input.source.sha256)}`

  return `set -eu
umask 077
${digest}${cachePaths("ssh", version)}${beginInstall}${source}
tar -xzf "$archive" -C "$stage" package/bin/panacode
test -d "$stage/package"
test ! -L "$stage/package"
test -d "$stage/package/bin"
test ! -L "$stage/package/bin"
test -f "$stage/package/bin/panacode"
test ! -L "$stage/package/bin/panacode"
chmod 755 "$stage/package/bin/panacode"
sha=$(sha256_of "$stage/package/bin/panacode") || { echo "Could not hash the Panacode CLI." >&2; exit 1; }
printf '{"product":"panacode","version":"%s","target":"%s","sha256":"%s"}\\n' ${quote(version)} ${quote(target)} "$sha" > "$stage/panacode.artifact.json"
binary="$stage/package/bin/panacode"
${publishGeneration}
`
}

/** Resolves the immutable artifact reference from registry metadata. */
export const artifact = Effect.fn("RemoteCli.artifact")(function* (target: string, version: string) {
  const http = yield* HttpClient.HttpClient
  const url = yield* Effect.try({ try: () => ManagedCli.metadataUrl(target, version), catch: Failure.from })

  const response = yield* http
    .get(url)
    .pipe(Effect.mapError(() => new Failure({ code: "install", detail: url })))
    .pipe(Effect.timeout("30 seconds"))

  if (response.status === 404)
    return yield* Effect.fail(new Failure({ code: "unpublished", detail: ManagedCli.unavailable(target, version) }))

  if (response.status < 200 || response.status >= 300)
    return yield* Effect.fail(
      new Failure({ code: "install", detail: `The managed Panacode CLI metadata returned HTTP ${response.status}` }),
    )

  const metadata = yield* HttpClientResponse.schemaBodyJson(ManagedCli.Metadata)(response).pipe(
    Effect.mapError(() => new Failure({ code: "install", detail: `Invalid Panacode CLI metadata at ${url}` })),
  )

  return yield* Effect.try({
    try: () => ManagedCli.artifact(target, version, metadata),
    catch: Failure.from,
  })
})