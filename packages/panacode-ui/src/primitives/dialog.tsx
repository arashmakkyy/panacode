import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { type JSX, Show, splitProps } from "solid-js"
import "./overlay.css"

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: JSX.Element
  description?: JSX.Element
  closeLabel: string
  children: JSX.Element
}

export function Dialog(props: DialogProps) {
  const [local] = splitProps(props, ["open", "onOpenChange", "title", "description", "closeLabel", "children"])

  return (
    <Kobalte open={local.open} onOpenChange={local.onOpenChange}>
      <Kobalte.Portal>
        <Kobalte.Overlay data-slot="dialog-overlay" />
        <Kobalte.Content data-component="panacode-dialog" data-panacode-primitive="dialog" data-slot="dialog-surface">
          <Kobalte.Title data-slot="dialog-title">{local.title}</Kobalte.Title>
          <Show when={local.description}>
            <Kobalte.Description data-slot="dialog-description">{local.description}</Kobalte.Description>
          </Show>
          {local.children}
          <Kobalte.CloseButton data-slot="dialog-close" aria-label={local.closeLabel}>
            ×
          </Kobalte.CloseButton>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
