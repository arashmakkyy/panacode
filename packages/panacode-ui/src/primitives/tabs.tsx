import { Content, List, Root, Trigger } from "@kobalte/core/tabs"
import { For, type JSX } from "solid-js"
import "./overlay.css"

export type TabItem = {
  value: string
  label: JSX.Element
  content: JSX.Element
}

export interface TabsProps {
  tabs: readonly TabItem[]
  value: string
  onChange: (value: string) => void
  label: string
}

export function Tabs(props: TabsProps) {
  return (
    <Root
      data-component="panacode-tabs"
      data-panacode-primitive="tabs"
      value={props.value}
      onChange={props.onChange}
      aria-label={props.label}
    >
      <List data-slot="tabs-list">
        <For each={props.tabs}>
          {(tab) => (
            <Trigger value={tab.value} data-slot="tabs-trigger">
              {tab.label}
            </Trigger>
          )}
        </For>
      </List>
      <For each={props.tabs}>
        {(tab) => <Content value={tab.value}>{tab.content}</Content>}
      </For>
    </Root>
  )
}
