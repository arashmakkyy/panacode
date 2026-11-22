import { Effect, FileSystem } from "effect"
import path from "node:path"

// The installer writes exactly this block and nothing else. Removal proves the whole block is
// still the installer's own fragment before deleting a byte of it.
export const SHELL_PATH_BEGIN = "# >>> panacode >>>"
export const SHELL_PATH_END = "# <<< panacode <<<"
const LEGACY_MARKER = "# panacode"

/**
 * The exact command lines the installer writes for one binary directory. The quoted form is the
 * current writer; the unquoted form is the legacy writer, which is still removed as an exact pair
 * with its `# panacode` comment.
 */
export function shellPathCommands(input: { readonly bin: string; readonly fish: boolean }) {
  return shellPathForms(input.bin).flatMap((bin) =>
    input.fish
      ? [`fish_add_path "${bin}"`, `fish_add_path ${bin}`]
      : [`export PATH="${bin}:$PATH"`, `export PATH=${bin}:$PATH`],
  )
}

export function isFishConfig(file: string) {
  return path.basename(file).toLowerCase() === "config.fish"
}

/** Shell config files in the same order the installer considers them. */
export function shellConfigCandidates(input: {
  readonly home: string
  readonly shell: string
  readonly env: Record<string, string | undefined>
}) {
  const xdg = input.env.XDG_CONFIG_HOME || path.join(input.home, ".config")
  const zsh = input.env.ZDOTDIR || input.home
  const candidates: Record<string, string[]> = {
    fish: [path.join(input.home, ".config/fish/config.fish"), path.join(xdg, "fish/config.fish")],
    zsh: [
      path.join(zsh, ".zshrc"),
      path.join(zsh, ".zshenv"),
      path.join(xdg, "zsh/.zshrc"),
      path.join(xdg, "zsh/.zshenv"),
    ],
    bash: [
      path.join(input.home, ".bashrc"),
      path.join(input.home, ".bash_profile"),
      path.join(input.home, ".profile"),
      path.join(xdg, "bash/.bashrc"),
      path.join(xdg, "bash/.bash_profile"),
    ],
    ash: [path.join(input.home, ".ashrc"), path.join(input.home, ".profile")],
    sh: [path.join(input.home, ".ashrc"), path.join(input.home, ".profile")],
  }
  return [...new Set(candidates[path.basename(input.shell || "bash")] ?? candidates.bash)]
}

/**
 * Remove only fragments the installer wrote for `commands`.
 *
 * A managed block is removed when its markers hold exactly one owned command line. A legacy pair is
 * removed when an exact `# panacode` comment is followed by an owned command. Everything else stays
 * byte-for-byte, including a combined PATH line, a custom command after a duplicate comment, a
 * half-written block, and an edited block. Line endings, a leading BOM, and a missing final newline
 * are preserved.
 */
export function cleanShellConfig(content: string, commands: readonly string[]) {
  if (!content) return content
  const owned = new Set(commands)
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : ""
  const body = bom ? content.slice(1) : content
  const lines = splitLines(body)
  const removed = new Set<number>()
  let changed = false

  for (let index = 0; index < lines.length; index++) {
    if (lines[index]?.text.trim() !== SHELL_PATH_BEGIN) continue
    const end = closingMarker(lines, index)
    if (end === undefined) continue
    const body = lines.slice(index + 1, end)
    if (body.length !== 1 || !owned.has(body[0]?.text.trim() ?? "")) continue
    removeFragment(lines, removed, index, end)
    changed = true
    index = end
  }

  for (let index = 0; index + 1 < lines.length; index++) {
    if (removed.has(index) || removed.has(index + 1)) continue
    if (lines[index]?.text.trim() !== LEGACY_MARKER) continue
    if (!owned.has(lines[index + 1]?.text.trim() ?? "")) continue
    removeFragment(lines, removed, index, index + 1)
    changed = true
    index++
  }

  if (!changed) return content
  return bom + lines.map((line, index) => (removed.has(index) ? "" : line.text + line.eol)).join("")
}

/**
 * True when a binary other than `current` still lives in the directory. V1, V2, and OpenCode
 * installs can share one bin directory, so its PATH entry must stay while anything else uses it.
 */
export const shellPathShared = Effect.fnUntraced(function* (bin: string, current: string) {
  const fs = yield* FileSystem.FileSystem
  const names = yield* fs.readDirectory(bin).pipe(Effect.orElseSucceed(() => []))
  return names.some((name) => name.toLowerCase() !== current.toLowerCase())
})

/**
 * Rewrite one shell config after proving the content did not change between the read that produced
 * the plan and the write. A concurrent edit leaves the file untouched and fails with an actionable
 * message. Writing through the existing path keeps a user's symlink and file permissions.
 */
export const cleanShellFile = Effect.fnUntraced(function* (file: string, commands: readonly string[]) {
  const fs = yield* FileSystem.FileSystem
  const content = decode(yield* fs.readFile(file))
  if (content === undefined) return false
  const cleaned = cleanShellConfig(content, commands)
  if (cleaned === content) return false
  if (decode(yield* fs.readFile(file)) !== content)
    return yield* Effect.fail(new Error(`${file} changed while uninstalling; left it unchanged for manual review`))
  yield* fs.writeFileString(file, cleaned)
  return true
})

// A BOM is part of the file, not whitespace. Bun's string reader drops it, so read bytes and keep
// U+FEFF in the text; writing the same string restores the original EF BB BF prefix.
const decoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true })
function decode(bytes: Uint8Array) {
  try { return decoder.decode(bytes) } catch { return undefined }
}

function shellPathForms(bin: string) {
  const forms = new Set([bin])
  const forward = bin.replaceAll("\\", "/")
  forms.add(forward)
  if (/^[A-Za-z]:\//.test(forward)) forms.add(`/${forward[0]?.toLowerCase()}${forward.slice(2)}`)
  return [...forms]
}

type Line = { readonly text: string; readonly eol: string }

function splitLines(body: string) {
  const lines: Line[] = []
  let start = 0
  for (let index = 0; index < body.length; index++) {
    if (body[index] !== "\n") continue
    const crlf = index > start && body[index - 1] === "\r"
    lines.push({ text: body.slice(start, crlf ? index - 1 : index), eol: crlf ? "\r\n" : "\n" })
    start = index + 1
  }
  if (start < body.length) lines.push({ text: body.slice(start), eol: "" })
  return lines
}

function closingMarker(lines: readonly Line[], start: number) {
  for (let index = start + 1; index < lines.length; index++) {
    const text = lines[index]?.text.trim()
    if (text === SHELL_PATH_BEGIN) return undefined
    if (text === SHELL_PATH_END) return index
  }
  return undefined
}

// The writer always prefixes a fragment with one newline. In the middle of a file that newline is
// the empty separator line; at the end it is either that separator or the terminator of the user's
// unterminated last line. Remove or strip it so deleting a fragment restores the original bytes.
function removeFragment(lines: Line[], removed: Set<number>, start: number, end: number) {
  for (let index = start; index <= end; index++) removed.add(index)
  const previous = start - 1
  if (previous < 0 || removed.has(previous)) return
  if (lines[previous]?.text === "") {
    removed.add(previous)
    return
  }
  if (end === lines.length - 1 && lines[previous]?.eol) lines[previous] = { text: lines[previous].text, eol: "" }
}
