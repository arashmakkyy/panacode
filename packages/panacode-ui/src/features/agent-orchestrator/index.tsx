import { For, type JSX } from "solid-js"
import "./agent-orchestrator.css"

export type OrchestratorLane = {
  id: string
  title: string
  status: "idle" | "active" | "done" | "error"
  body?: JSX.Element
}

export interface AgentOrchestratorProps {
  lanes: readonly OrchestratorLane[]
  class?: string
}

/** Lane board for delegated / subagent work — bind real task graphs via adapter. */
export function AgentOrchestrator(props: AgentOrchestratorProps) {
  return (
    <div data-component="panacode-agent-orchestrator" data-panacode-feature="agent-orchestrator" class={props.class}>
      <For each={props.lanes}>
        {(lane) => (
          <section data-slot="lane" data-status={lane.status}>
            <header>
              <h4>{lane.title}</h4>
              <span>{lane.status}</span>
            </header>
            <div data-slot="lane-body">{lane.body}</div>
          </section>
        )}
      </For>
    </div>
  )
}
