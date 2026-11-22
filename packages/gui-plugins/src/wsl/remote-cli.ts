// The part of the SSH plugin's remote CLI scripts that WSL uses. Plugins share only contracts, so
// keep the two copies in step with packages/gui-plugins/src/ssh/remote-cli.ts.

import { beginInstall, cachePaths, publishGeneration, selectGeneration } from "../remote-cache"
import { ManagedCli } from "../managed-cli"

export function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function requireVersion(version: string) {
  if (!ManagedCli.validVersion(version)) throw new Error(version)

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
  return `${digest}${cachePaths("wsl", version)}${selectGeneration(version, target)}
if [ -n "$cli" ]; then printf '%s\\n' "$cli"; fi
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

export type WslCliSource =
  | { readonly kind: "local"; readonly binary: string; readonly sha256: string }
  | { readonly kind: "managed"; readonly url: string; readonly sha512: string }

export type WslCliInstall = {
  readonly version: string
  readonly target: string
  readonly source: WslCliSource
}

/**
 * Installs one verified CLI into the private WSL location. A local build is copied by
 * `wslpath`; a managed build is downloaded after the trusted reference was resolved on
 * the Windows side. Both verify the destination bytes before an atomic replacement.
 */
export function installScript(input: WslCliInstall) {
  const version = requireVersion(input.version)
  const target = ManagedCli.requireTarget(input.target)

  const source =
    input.source.kind === "local"
      ? `source=$(wslpath -a ${quote(input.source.binary)})
test -f "$source"
cp "$source" "$stage/panacode"
binary="$stage/panacode"
actual=$(sha256_of "$binary") || { echo "Could not hash the Panacode CLI." >&2; exit 1; }
test "$actual" = ${quote(input.source.sha256)}`
      : `archive="$stage/archive.tgz"
url=${quote(input.source.url)}
if command -v curl >/dev/null 2>&1; then
  curl -fsSL --connect-timeout 15 --max-time 300 "$url" -o "$archive"
else
  wget -T 300 -O "$archive" "$url"
fi
test -s "$archive"
actual=$(sha512_of "$archive") || { echo "Could not hash the Panacode CLI archive." >&2; exit 1; }
test "$actual" = ${quote(input.source.sha512)}
tar -xzf "$archive" -C "$stage" package/bin/panacode
test -d "$stage/package"
test ! -L "$stage/package"
test -d "$stage/package/bin"
test ! -L "$stage/package/bin"
test -f "$stage/package/bin/panacode"
test ! -L "$stage/package/bin/panacode"
binary="$stage/package/bin/panacode"`

  return `set -eu
umask 077
${digest}${cachePaths("wsl", version)}${beginInstall}${source}
chmod 755 "$binary"
sha=$(sha256_of "$binary") || { echo "Could not hash the Panacode CLI." >&2; exit 1; }
printf '{"product":"panacode","version":"%s","target":"%s","sha256":"%s"}\\n' ${quote(version)} ${quote(target)} "$sha" > "$stage/panacode.artifact.json"
${publishGeneration}
`
}