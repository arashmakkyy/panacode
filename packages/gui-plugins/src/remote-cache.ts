// Each writer builds privately. The receipt is the only published pointer: while a
// download is in progress readers continue to see one complete, verified generation.
export function cachePaths(kind: "ssh" | "wsl", version: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(version)) throw new Error("Invalid CLI version")
  return `root="$HOME/.panacode/desktop-${kind}-v2"
release="$root"/'${version}'
metadata="$release/panacode.artifact.json"
owner_uid=$(id -u)
private_entry() {
  [ ! -L "$1" ] || return 1
  [ -e "$1" ] || return 0
  attrs=$(stat -c '%u:%a' "$1" 2>/dev/null) || attrs=$(stat -f '%u:%Lp' "$1") || return 1
  uid=\${attrs%%:*}
  mode=\${attrs#*:}
  case "$mode" in ""|*[!0-7]*) return 1 ;; esac
  [ "$uid" = "$owner_uid" ] && [ "$((0$mode & 022))" -eq 0 ]
}
ordinary_parents() {
  private_entry "$HOME" && private_entry "$HOME/.panacode" && private_entry "$root" && private_entry "$release" && private_entry "$metadata"
}
`
}

export const beginInstall = `ordinary_parents || { echo "Refusing a redirected Panacode cache." >&2; exit 1; }
mkdir -p "$release"
ordinary_parents || exit 1
[ ! -e "$metadata" ] || [ -f "$metadata" ] || exit 1
stage=$(mktemp -d "$release/.install-XXXXXX")
trap 'rm -rf "$stage"' EXIT
trap 'exit 1' HUP INT TERM
`

export const publishGeneration = `destination="$release/panacode.$sha"
private_entry "$destination" || exit 1
[ ! -e "$destination" ] || [ -f "$destination" ] || exit 1
mv -f "$binary" "$destination"
mv -f "$stage/panacode.artifact.json" "$metadata"
`

export function selectGeneration(version: string, target: string) {
  // All fields come from a single read, even if another installer is publishing.
  return `cli=""
if ordinary_parents && [ -f "$metadata" ]; then
  receipt=$(cat "$metadata")
  stored=$(printf '%s' "$receipt" | sed -n 's/^.*"sha256":"\\([0-9a-f]*\\)"}$/\\1/p')
  expected=$(printf '{"product":"panacode","version":"%s","target":"%s","sha256":"%s"}' '${version}' '${target}' "$stored")
  candidate="$release/panacode.$stored"
  if [ "\${#stored}" -eq 64 ] && [ "$expected" = "$receipt" ] && [ -f "$candidate" ] && private_entry "$candidate"; then
    actual=$(sha256_of "$candidate") || actual=""
    if [ "$actual" = "$stored" ]; then cli="$candidate"; fi
  fi
fi
`
}
