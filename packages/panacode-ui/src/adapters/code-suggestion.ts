import type { CodeSuggestionHunk } from "../features/code-suggestion"
import type { Decisions } from "../features/code-suggestion/apply"

type PatchLine = { sign: " " | "-" | "+"; text: string }
type PatchHunk = { start: number; lines: PatchLine[] }

/** Keep the line terminator as part of each token. The no-newline marker applies only to the preceding side. */
export function parsePatchHunks(patch: string): PatchHunk[] {
  const hunks: PatchHunk[] = []
  let current: PatchHunk | undefined
  for (const raw of patch.split("\n")) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(raw)
    if (header) {
      current = { start: Number(header[1]) - (header[2] === "0" ? 0 : 1), lines: [] }
      hunks.push(current)
      continue
    }
    if (!current) continue
    const sign = raw[0]
    if (sign === " " || sign === "-" || sign === "+") current.lines.push({ sign, text: raw.slice(1) + "\n" })
    if (raw.startsWith("\\ No newline")) {
      const last = current.lines.at(-1)
      if (last) last.text = last.text.slice(0, -1)
    }
  }
  return hunks
}

const matches = (lines: string[], at: number, values: readonly string[]) =>
  at >= 0 && at + values.length <= lines.length && values.every((value, i) => lines[at + i] === value)

export function suggestionFromPatch(patch: string, current: string) {
  const bom = current.startsWith("\uFEFF") ? "\uFEFF" : ""
  const after = current.slice(bom.length).match(/[^\n]*\n|[^\n]+$/g) ?? []
  const before: string[] = []
  const hunks: CodeSuggestionHunk[] = []
  const inserts: string[][] = []
  const rejected: string[] = []
  let cursor = 0
  let shift = 0
  let conflict = false
  const patches = parsePatchHunks(patch)
  // Git may produce an LF patch for an entirely CRLF worktree. An explicit CR on either side of
  // the diff describes a real line-ending change and takes precedence over this conversion.
  if (
    after.some((line) => line.endsWith("\r\n")) &&
    after.every((line) => !line.endsWith("\n") || line.endsWith("\r\n")) &&
    !patches.some((hunk) => hunk.lines.some((line) => line.text.endsWith("\r\n")))
  ) {
    for (const hunk of patches)
      for (const line of hunk.lines) {
        if (line.text.endsWith("\n")) line.text = line.text.slice(0, -1) + "\r\n"
      }
  }
  for (const [index, hunk] of patches.entries()) {
    const start = Math.max(0, hunk.start) + shift
    if (start < cursor || start > after.length) {
      conflict = true
      break
    }
    while (cursor < start) before.push(after[cursor++])
    let part = 0
    const lines = hunk.lines
    // Some edit tools include the BOM in their patch and others strip it while reading the file.
    if (start === 0 && bom) {
      for (const sign of ["-", "+"] as const) {
        const first = lines.find((line) => line.sign === sign || line.sign === " ")
        if (first) first.text = first.text.replace(/^\uFEFF/, "")
      }
    }
    for (let i = 0; i < lines.length; ) {
      if (lines[i].sign === " ") {
        const text = lines[i++].text
        if (after[cursor++] !== text) conflict = true
        before.push(text)
        continue
      }
      const removed: string[] = []
      const added: string[] = []
      while (i < lines.length && lines[i].sign !== " ") {
        const line = lines[i++]
        ;(line.sign === "-" ? removed : added).push(line.text)
      }
      const context: string[] = []
      for (let j = i; j < lines.length && lines[j].sign === " "; j++) context.push(lines[j].text)
      const fits = (side: string[]) => matches(after, cursor, side) && matches(after, cursor + side.length, context)
      let applied = fits(added)
      let reverted = fits(removed)
      if (
        applied &&
        reverted &&
        i === lines.length &&
        index === patches.length - 1 &&
        (cursor + added.length === after.length || cursor + removed.length === after.length)
      ) {
        applied = cursor + added.length === after.length
        reverted = cursor + removed.length === after.length
      }
      if (applied === reverted) conflict = true
      const id = `h${index}-${part++}`
      hunks.push({
        id,
        start: before.length,
        remove: removed.length,
        insert: added.map((line) => line.replace(/\r?\n$/, "")),
      })
      inserts.push(added)
      for (const line of removed) before.push(line)
      if (reverted && !applied) {
        rejected.push(id)
        cursor += removed.length
        shift += removed.length - added.length
      } else cursor += added.length
    }
  }
  while (cursor < after.length) before.push(after[cursor++])
  function render(decisions: Decisions) {
    const output = [bom]
    let pos = 0
    for (const [i, hunk] of hunks.entries()) {
      while (pos < hunk.start) output.push(before[pos++])
      if (decisions[hunk.id] === "rejected") {
        for (let n = 0; n < hunk.remove!; n++) output.push(before[pos + n])
      } else for (const line of inserts[i]) output.push(line)
      pos += hunk.remove!
    }
    while (pos < before.length) output.push(before[pos++])
    return output.join("")
  }
  return { code: before.join(""), hunks, rejected, conflict: conflict || !patches.length, render }
}
