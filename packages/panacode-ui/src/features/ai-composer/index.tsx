import { Show, type JSX } from "solid-js"
import { Button } from "../../primitives/button"
import "./ai-composer.css"

export interface AiComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onStop?: () => void
  busy?: boolean
  placeholder?: string
  sendLabel: string
  stopLabel: string
  toolbar?: JSX.Element
  modelSlot?: JSX.Element
  disabled?: boolean
  class?: string
}

/** Composer chrome. Wire OpenCode composer controllers into these callbacks. */
export function AiComposer(props: AiComposerProps) {
  return (
    <form
      data-component="panacode-ai-composer"
      data-panacode-feature="ai-composer"
      class={props.class}
      onSubmit={(event) => {
        event.preventDefault()
        if (!props.busy) props.onSubmit()
      }}
    >
      <Show when={props.toolbar}>
        <div data-slot="composer-toolbar">{props.toolbar}</div>
      </Show>
      <textarea
        data-slot="composer-input"
        value={props.value}
        disabled={props.disabled}
        placeholder={props.placeholder}
        rows={3}
        onInput={(event) => props.onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            if (!props.busy && !props.disabled) props.onSubmit()
          }
        }}
      />
      <div data-slot="composer-actions">
        <div data-slot="composer-model">{props.modelSlot}</div>
        <Show
          when={!props.busy}
          fallback={
            <Button type="button" variant="secondary" onClick={() => props.onStop?.()}>
              {props.stopLabel}
            </Button>
          }
        >
          <Button type="submit" disabled={props.disabled || !props.value.trim()}>
            {props.sendLabel}
          </Button>
        </Show>
      </div>
    </form>
  )
}

export { ComposerHero, SuggestionChips, type ComposerSuggestion } from "./hero"
export {
  SendButton,
  EffortMenu,
  AttachmentChip,
  type SendState,
  type EffortOption,
  type AttachmentStatus,
} from "./parts"
