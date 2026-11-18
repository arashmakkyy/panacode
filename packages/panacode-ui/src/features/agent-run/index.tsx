import { For, Show, type JSX } from "solid-js"
import "./agent-run.css"

export type AgentRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

export type AgentRunStep = {
  id: string
  title: string
  status: AgentRunStatus
  detail?: JSX.Element
}

export interface AgentRunProps {
  title: string
  status: AgentRunStatus
  statusLabel: string
  steps: readonly AgentRunStep[]
  class?: string
}

export function AgentRun(props: AgentRunProps) {
  return (
    <section data-component="panacode-agent-run" data-panacode-feature="agent-run" data-status={props.status} class={props.class}>
      <header data-slot="run-header">
        <h3>{props.title}</h3>
        <span data-slot="run-status">{props.statusLabel}</span>
      </header>
      <ol data-slot="run-steps">
        <For each={props.steps}>
          {(step) => (
            <li data-status={step.status}>
              <div data-slot="step-title">{step.title}</div>
              <Show when={step.detail}>
                <div data-slot="step-detail">{step.detail}</div>
              </Show>
            </li>
          )}
        </For>
      </ol>
    </section>
  )
}
