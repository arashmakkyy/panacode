/**
 * Canonical Panacode Switch — SolidJS + Kobalte, Arc visual language from the MCP Servers reference.
 * Prefer this (or the restyled `@opencode/ui/switch` CSS overlay) for all application toggles.
 */
import { Control, Description, ErrorMessage, Input, Label, Root, Thumb } from "@kobalte/core/switch"
import { Show, splitProps, type ComponentProps, type ParentProps } from "solid-js"
import "./switch.css"

export interface SwitchProps extends ParentProps<ComponentProps<typeof Root>> {
  hideLabel?: boolean
  description?: string
}

export function Switch(props: SwitchProps) {
  const [local, others] = splitProps(props, ["children", "class", "classList", "hideLabel", "description"])

  return (
    <Root
      {...others}
      data-component="panacode-switch"
      data-panacode-primitive="switch"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <Input data-slot="switch-input" />
      <Show when={local.children}>
        {(label) => (
          <Label data-slot="switch-label" classList={{ "sr-only": local.hideLabel }}>
            {label()}
          </Label>
        )}
      </Show>
      <Show when={local.description}>
        <Description data-slot="switch-description">{local.description}</Description>
      </Show>
      <Control data-slot="switch-control">
        <Thumb data-slot="switch-thumb" />
      </Control>
      <ErrorMessage data-slot="switch-error" />
    </Root>
  )
}
