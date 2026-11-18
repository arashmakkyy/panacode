import type { OrchestratorLane } from "../features/agent-orchestrator"
import type { JSX } from "solid-js"

/** Maps delegated/subagent task rows into Panacode AgentOrchestrator presentation props. */
export function toOrchestratorLanes(
  tasks: readonly {
    id: string
    title: string
    status: string
    body?: JSX.Element
  }[],
): OrchestratorLane[] {
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: normalizeStatus(task.status),
    body: task.body,
  }))
}

function normalizeStatus(status: string): OrchestratorLane["status"] {
  switch (status) {
    case "pending":
    case "queued":
    case "idle":
      return "idle"
    case "running":
    case "busy":
    case "in_progress":
    case "active":
      return "active"
    case "error":
    case "failed":
      return "error"
    default:
      return "done"
  }
}
