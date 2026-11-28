import { For, Show } from "solid-js"
import { shortcutParts } from "./shortcut-parts"
import "./shortcut-keys.css"

export { shortcutParts }

/** One cap per key with explicit separators for key combinations and alternative bindings. */
export function ShortcutKeys(props: { binding: string }) {
  return (
    <span class="pc-shortcut-keys" role="group" aria-label={props.binding}>
      <For each={shortcutParts(props.binding)}>
        {(chord, position) => (
          <>
            <Show when={position() > 0}><span aria-hidden="true">, </span></Show>
            <span class="pc-shortcut-chord" aria-hidden="true">
              <For each={chord}>
                {(key, index) => (
                  <>
                    <Show when={index() > 0}>+</Show>
                    <kbd>{key}</kbd>
                  </>
                )}
              </For>
            </span>
          </>
        )}
      </For>
    </span>
  )
}
