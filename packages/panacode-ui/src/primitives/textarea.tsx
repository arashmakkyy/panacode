import { type ComponentProps, Show, splitProps } from "solid-js"
import "./input.css"

export interface TextareaProps extends ComponentProps<"textarea"> {
  label?: string
  description?: string
  error?: string
}

export function Textarea(props: TextareaProps) {
  const [local, rest] = splitProps(props, ["label", "description", "error", "class", "classList", "id"])
  const fieldId = () => local.id ?? "panacode-textarea"

  return (
    <label data-component="panacode-field" data-panacode-primitive="textarea" class={local.class}>
      <Show when={local.label}>
        <span data-slot="field-label">{local.label}</span>
      </Show>
      <textarea
        {...rest}
        id={fieldId()}
        data-slot="field-control"
        aria-invalid={local.error ? true : undefined}
        classList={local.classList}
      />
      <Show when={local.description}>
        <span data-slot="field-description">{local.description}</span>
      </Show>
      <Show when={local.error}>
        <span data-slot="field-error">{local.error}</span>
      </Show>
    </label>
  )
}
