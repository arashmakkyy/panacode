import type { ApprovalRequest } from "../features/agent-approvals"
import type { JSX } from "solid-js"

/** Maps OpenCode permission requests into Panacode AgentApprovals presentation props. */
export function toApprovalRequests(
  requests: readonly {
    id: string
    title: string
    detail?: JSX.Element
    scope?: string
  }[],
): ApprovalRequest[] {
  return requests.map((request) => ({
    id: request.id,
    title: request.title,
    detail: request.detail,
    scope: request.scope,
  }))
}

/** Normalize once/always/reject into the approval dock's binary approve/reject surface. */
export function toApprovalDecision(action: "approve" | "reject"): "once" | "reject" {
  return action === "approve" ? "once" : "reject"
}
