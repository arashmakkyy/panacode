import { For } from "solid-js"
import { shortcutParts } from "./shortcut-parts"
import "./shortcut-keys.css"

export { shortcutParts }

/** Arc shortcut caps: one soft cap per key, chords side by side. */
export function ShortcutKeys(props: { binding: string }) {
  return (
    <span class="pc-shortcut-keys" aria-label={props.binding}>
      <For each={shortcutParts(props.binding)}>
        {(chord) => (
          <span class="pc-shortcut-chord" aria-hidden="true">
            <For each={chord}>{(key) => <kbd>{key}</kbd>}</For>
          </span>
        )}
      </For>
    </span>
  )
}
