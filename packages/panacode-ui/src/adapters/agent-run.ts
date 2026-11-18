import type { AgentRunStatus } from "../features/agent-run"

export function toAgentRunStatus(status: string | undefined): AgentRunStatus {
  switch (status) {
    case "queued":
    case "pending":
      return "queued"
    case "running":
    case "in_progress":
    case "busy":
      return "running"
    case "error":
    case "failed":
      return "failed"
    case "cancelled":
    case "aborted":
      return "cancelled"
    default:
      return "completed"
  }
}
