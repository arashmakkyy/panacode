import type { SuggestionHunk, SuggestionMode } from "../features/code-suggestion"
import type { JSX } from "solid-js"

/** Maps review hunk rows into Panacode CodeSuggestion presentation props. */
export function toSuggestionHunks(
  hunks: readonly {
    id: string
    path: string
    body: JSX.Element
  }[],
): SuggestionHunk[] {
  return hunks.map((hunk) => ({
    id: hunk.id,
    path: hunk.path,
    body: hunk.body,
  }))
}

export function toSuggestionMode(mode: string | undefined): SuggestionMode {
  return mode === "split" ? "split" : "unified"
}
