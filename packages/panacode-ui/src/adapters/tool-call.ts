import type { ToolCallStatus } from "../features/tool-call"

/** Normalize OpenCode tool part status strings into Panacode ToolCall status. */
export function toToolCallStatus(status: string | undefined): ToolCallStatus {
  switch (status) {
    case "pending":
    case "queued":
      return "pending"
    case "running":
    case "in_progress":
      return "running"
    case "error":
    case "failed":
      return "error"
    default:
      return "completed"
  }
}
