import { For, Show, type JSX } from "solid-js"
import { BrandMark } from "../../brand"

/** Empty-state headline above the composer (Arc AI Composer). */
export function ComposerHero(props: { title: string; subtitle?: string }) {
  return (
    <div data-component="panacode-composer-hero">
      <div data-slot="hero-mark" aria-hidden="true">
        <BrandMark size={36} tone="mono" />
      </div>
      <h1 data-slot="hero-title">{props.title}</h1>
      <Show when={props.subtitle}>
        <p data-slot="hero-subtitle">{props.subtitle}</p>
      </Show>
    </div>
  )
}

export interface ComposerSuggestion {
  id: string
  label: string
  prompt: string
  icon?: JSX.Element
}

/** Ghost suggestion pills under the composer. Picking one hands its prompt back to the real composer. */
export function SuggestionChips(props: { items: ComposerSuggestion[]; onPick: (item: ComposerSuggestion) => void }) {
  return (
    <ul data-component="panacode-suggestion-chips">
      <For each={props.items}>
        {(item) => (
          <li><button
            type="button"
            data-slot="suggestion-chip"
            data-suggestion={item.id}
            onClick={() => props.onPick(item)}
          >
            <Show when={item.icon}>
              <span data-slot="chip-icon">{item.icon}</span>
            </Show>
            <span>{item.label}</span>
          </button></li>
        )}
      </For>
    </ul>
  )
}
