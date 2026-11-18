import { Content, Portal, Root, Trigger } from "@kobalte/core/tooltip"
import { type JSX } from "solid-js"
import "./overlay.css"

export interface TooltipProps {
  content: JSX.Element
  children: JSX.Element
}

export function Tooltip(props: TooltipProps) {
  return (
    <Root>
      <Trigger data-panacode-primitive="tooltip" as="span">
        {props.children}
      </Trigger>
      <Portal>
        <Content data-component="panacode-tooltip" data-slot="tooltip-surface">
          {props.content}
        </Content>
      </Portal>
    </Root>
  )
}
