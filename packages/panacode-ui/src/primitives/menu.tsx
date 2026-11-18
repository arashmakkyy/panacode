import { DropdownMenu } from "@kobalte/core/dropdown-menu"
import { For, type JSX } from "solid-js"
import "./overlay.css"

export type MenuItem = {
  id: string
  label: JSX.Element
  disabled?: boolean
  onSelect: () => void
}

export interface MenuProps {
  label: string
  items: readonly MenuItem[]
  children: JSX.Element
}

/** Arc dropdown. The trigger is the child; items call `onSelect` and then close. */
export function Menu(props: MenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger data-component="panacode-menu-trigger" data-panacode-primitive="menu" aria-label={props.label}>
        {props.children}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content data-component="panacode-menu" data-slot="overlay-surface">
          <For each={props.items}>
            {(item) => (
              <DropdownMenu.Item
                data-slot="overlay-item"
                disabled={item.disabled}
                onSelect={item.onSelect}
                textValue={item.id}
              >
                {item.label}
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
