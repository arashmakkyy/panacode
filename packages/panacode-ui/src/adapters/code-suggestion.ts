import type { CodeSuggestionHunk } from "../features/code-suggestion"

type PatchLine = { sign: " " | "-" | "+"; text: string }
type PatchHunk = { oldStart: number; newStart: number; lines: PatchLine[] }

/** Parses the hunks of a unified diff for one file. "\ No newline" markers are ignored. */
export function parsePatchHunks(patch: string): PatchHunk[] {
  const hunks: PatchHunk[] = []
  let current: PatchHunk | undefined
  for (const raw of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (header) {
      current = { oldStart: Number(header[1]), newStart: Number(header[2]), lines: [] }
      hunks.push(current)
      continue
    }
    if (!current) continue
    const sign = raw[0]
    if (sign === " " || sign === "-" || sign === "+") current.lines.push({ sign, text: raw.slice(1) })
    else if (raw === "") current.lines.push({ sign: " ", text: "" })
  }
  // A trailing empty line from the split is not part of the last hunk.
  const last = hunks[hunks.length - 1]
  if (last && last.lines.length && last.lines[last.lines.length - 1].sign === " " && last.lines[last.lines.length - 1].text === "" && patch.endsWith("\n"))
    last.lines.pop()
  return hunks
}

export type SuggestionFromPatch = {
  /** The file before the edit (reconstructed from the current file). */
  code: string
  /** Arc hunks in `code` line coordinates. */
  hunks: CodeSuggestionHunk[]
  /** Hunks the file already has reverted (rejected earlier), so the card opens with them settled. */
  rejected: string[]
  /** The current file matches neither what the edit wrote nor what it replaced. */
  conflict: boolean
}

const matches = (after: string[], at: number, lines: string[]) => lines.every((line, i) => after[at + i] === line)

/**
 * Builds the Code Suggestion input from an applied edit: the unified patch plus the file as it is on disk now.
 * Each change is found by its new side (kept) or its old side (already rejected). Anything else means the file
 * changed after the edit, so per-hunk reject must not write it.
 */
export function suggestionFromPatch(patch: string, current: string): SuggestionFromPatch {
  const after = current.split("\n")
  const before: string[] = []
  const hunks: CodeSuggestionHunk[] = []
  const rejected: string[] = []
  let conflict = false
  let cursor = 0 // index in `after`
  let shift = 0 // how far already rejected changes moved the file from the patch's new side
  for (const [index, hunk] of parsePatchHunks(patch).entries()) {
    const start = Math.max(0, hunk.newStart - 1) + shift
    if (start < cursor) {
      conflict = true
      break
    }
    before.push(...after.slice(cursor, start))
    let a = start
    let part = 0
    const lines = hunk.lines
    for (let i = 0; i < lines.length; ) {
      if (lines[i].sign === " ") {
        if (after[a] !== lines[i].text) conflict = true
        before.push(lines[i].text)
        a++
        i++
        continue
      }
      const removed: string[] = []
      const added: string[] = []
      while (i < lines.length && lines[i].sign !== " ") {
        if (lines[i].sign === "-") removed.push(lines[i].text)
        else added.push(lines[i].text)
        i++
      }
      const run: CodeSuggestionHunk = { id: `h${index}-${part++}`, start: before.length, remove: removed.length, insert: added }
      hunks.push(run)
      before.push(...removed)
      if (matches(after, a, added)) a += added.length
      else if (matches(after, a, removed)) {
        rejected.push(run.id)
        a += removed.length
        shift += removed.length - added.length
      } else {
        conflict = true
        a += added.length
      }
    }
    cursor = a
  }
  before.push(...after.slice(Math.min(cursor, after.length)))
  return { code: before.join("\n"), hunks, rejected, conflict }
}
