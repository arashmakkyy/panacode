import { Content, Item, ItemLabel, Listbox, Portal, Root, Trigger, Value } from "@kobalte/core/select"
import { type JSX, splitProps } from "solid-js"
import "./overlay.css"

export type SelectOption<T extends string = string> = {
  value: T
  label: JSX.Element
  disabled?: boolean
}

export interface SelectProps<T extends string = string> {
  options: readonly SelectOption<T>[]
  value?: T
  onChange?: (value: T) => void
  placeholder?: string
  label: string
  disabled?: boolean
  class?: string
}

export function Select<T extends string>(props: SelectProps<T>) {
  const [local] = splitProps(props, ["options", "value", "onChange", "placeholder", "label", "disabled", "class"])

  return (
    <Root<SelectOption<T>>
      data-component="panacode-select"
      data-panacode-primitive="select"
      class={local.class}
      options={[...local.options]}
      optionValue="value"
      optionTextValue="value"
      optionDisabled="disabled"
      value={local.options.find((option) => option.value === local.value)}
      onChange={(option) => option && local.onChange?.(option.value)}
      disabled={local.disabled}
      placeholder={local.placeholder}
      itemComponent={(item) => (
        <Item item={item.item} data-slot="overlay-item">
          <ItemLabel>{item.item.rawValue.label}</ItemLabel>
        </Item>
      )}
    >
      <Trigger data-slot="select-trigger" aria-label={local.label}>
        <Value<SelectOption<T>>>{(state) => state.selectedOption()?.label ?? local.placeholder}</Value>
      </Trigger>
      <Portal>
        <Content data-slot="overlay-surface">
          <Listbox data-slot="overlay-list" />
        </Content>
      </Portal>
    </Root>
  )
}
