import { Show, createSignal, type JSX } from "solid-js"
import "./tool-call.css"

export type ToolCallStatus = "pending" | "running" | "completed" | "error"

export interface ToolCallProps {
  name: string
  status: ToolCallStatus
  args?: JSX.Element
  output?: JSX.Element
  error?: string
  defaultOpen?: boolean
  class?: string
}

export function ToolCall(props: ToolCallProps) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? props.status !== "completed")

  return (
    <details
      data-component="panacode-tool-call"
      data-panacode-feature="tool-call"
      data-status={props.status}
      class={props.class}
      open={open()}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span data-slot="tool-name">{props.name}</span>
        <span data-slot="tool-status">{props.status}</span>
      </summary>
      <Show when={props.args}>
        <div data-slot="tool-args">{props.args}</div>
      </Show>
      <Show when={props.output}>
        <div data-slot="tool-output">{props.output}</div>
      </Show>
      <Show when={props.error}>
        <div data-slot="tool-error" role="alert">
          {props.error}
        </div>
      </Show>
    </details>
  )
}
