import type { CodeSuggestionDecision, CodeSuggestionHunk } from "./index"

export type Hunk = Required<Pick<CodeSuggestionHunk, "id" | "start" | "remove" | "insert">> & {
  summary?: string
  source: CodeSuggestionHunk
}
export type Decisions = Partial<Record<string, CodeSuggestionDecision>>

/** Sorts hunks, clamps them to the file and drops any that overlap an earlier one. */
export function normalizeHunks(hunks: CodeSuggestionHunk[], lineCount: number): Hunk[] {
  const sorted = [...hunks].sort((a, b) => a.start - b.start)
  const result: Hunk[] = []
  let cursor = 0
  for (const hunk of sorted) {
    const start = Math.min(Math.max(0, Math.floor(hunk.start)), lineCount)
    if (start < cursor) continue
    const remove = Math.min(Math.max(0, hunk.remove ?? 0), lineCount - start)
    result.push({ id: hunk.id, start, remove, insert: hunk.insert ?? [], summary: hunk.summary, source: hunk })
    cursor = start + remove
  }
  return result
}

/** The file with every hunk applied except the rejected ones (OpenCode applied them all already). */
export function applyDecisions(lines: string[], hunks: CodeSuggestionHunk[], decisions: Decisions, keepPending = true) {
  const out: string[] = []
  let cursor = 0
  for (const hunk of normalizeHunks(hunks, lines.length)) {
    while (cursor < hunk.start) out.push(lines[cursor++])
    const decision = decisions[hunk.id]
    if (decision === "accepted" || (keepPending && !decision)) {
      for (const line of hunk.insert) out.push(line)
    } else {
      for (let i = 0; i < hunk.remove; i++) out.push(lines[hunk.start + i])
    }
    cursor = hunk.start + hunk.remove
  }
  while (cursor < lines.length) out.push(lines[cursor++])
  return out.join("\n")
}

