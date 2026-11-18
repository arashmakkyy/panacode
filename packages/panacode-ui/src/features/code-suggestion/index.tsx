import { For, type JSX } from "solid-js"
import { Button } from "../../primitives/button"
import { SegmentedControl } from "../../primitives/segmented-control"
import "./code-suggestion.css"

export type SuggestionMode = "unified" | "split"

export type SuggestionHunk = {
  id: string
  path: string
  body: JSX.Element
}

export interface CodeSuggestionProps {
  title: string
  mode: SuggestionMode
  onModeChange: (mode: SuggestionMode) => void
  hunks: readonly SuggestionHunk[]
  onAccept?: (id: string) => void
  onReject?: (id: string) => void
  class?: string
  labels: {
    unified: string
    split: string
    accept: string
    reject: string
    layoutAria: string
  }
}

/** Review presentation — keep Pierre/diff engines in OpenCode; render through this shell. */
export function CodeSuggestion(props: CodeSuggestionProps) {
  return (
    <section data-component="panacode-code-suggestion" data-panacode-feature="code-suggestion" class={props.class}>
      <header data-slot="suggestion-header">
        <h3>{props.title}</h3>
        <SegmentedControl
          aria-label={props.labels.layoutAria}
          value={props.mode}
          onChange={props.onModeChange}
          options={[
            { value: "unified", label: props.labels.unified },
            { value: "split", label: props.labels.split },
          ]}
        />
      </header>
      <For each={props.hunks}>
        {(hunk) => (
          <article data-slot="suggestion-hunk" data-mode={props.mode}>
            <header>
              <code>{hunk.path}</code>
              <div data-slot="hunk-actions">
                <Button size="sm" variant="secondary" onClick={() => props.onReject?.(hunk.id)}>
                  {props.labels.reject}
                </Button>
                <Button size="sm" onClick={() => props.onAccept?.(hunk.id)}>
                  {props.labels.accept}
                </Button>
              </div>
            </header>
            <div data-slot="hunk-body">{hunk.body}</div>
          </article>
        )}
      </For>
    </section>
  )
}
