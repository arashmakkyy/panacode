import { Control, Indicator, Input, Label, Root } from "@kobalte/core/checkbox"
import { type ComponentProps, Show, splitProps } from "solid-js"
import "./choice.css"

export interface CheckboxProps extends ComponentProps<typeof Root> {
  label?: string
}

export function Checkbox(props: CheckboxProps) {
  const [local, rest] = splitProps(props, ["label", "children", "class", "classList"])

  return (
    <Root
      {...rest}
      data-component="panacode-checkbox"
      data-panacode-primitive="checkbox"
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    >
      <Input data-slot="choice-input" />
      <Control data-slot="choice-control">
        <Indicator data-slot="choice-indicator">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 8.2 6.4 11.1 12.5 4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </Indicator>
      </Control>
      <Show when={local.label}>
        <Label data-slot="choice-label">{local.label}</Label>
      </Show>
    </Root>
  )
}
