import { describe, expect, test } from "bun:test"
import { toMcpServerViews } from "./mcp-servers"
import { toToolCallStatus } from "./tool-call"
import { toAgentRunStatus } from "./agent-run"
import { toComposerMode } from "./ai-composer"
import { toOrchestratorLanes } from "./agent-orchestrator"
import { toApprovalDecision } from "./agent-approvals"

describe("panacode adapters", () => {
  test("maps MCP server status into presentation views", () => {
    expect(
      toMcpServerViews([
        { name: "fs", status: { status: "connected" } },
        { name: "broken", status: { status: "failed", error: "timeout" } },
        { name: "off", status: { status: "disabled" } },
      ]),
    ).toEqual([
      { id: "fs", name: "fs", enabled: true, connected: true, error: undefined },
      { id: "broken", name: "broken", enabled: true, connected: false, error: "timeout" },
      { id: "off", name: "off", enabled: false, connected: false, error: undefined },
    ])
  })

  test("normalizes tool and agent statuses", () => {
    expect(toToolCallStatus({ id: "a", name: "read", state: { status: "running", input: {} }, time: { created: 1 } })).toBe("running")
    expect(toToolCallStatus({ id: "b", name: "read", state: { status: "error", input: {}, error: { message: "boom" } }, time: { created: 1 } })).toBe("error")
    expect(toAgentRunStatus("aborted")).toBe("stopped")
    expect(toAgentRunStatus("busy")).toBe("working")
  })

  test("maps composer, orchestrator, review, and approval helpers", () => {
    expect(toComposerMode({ streaming: true })).toBe("streaming")
    expect(toComposerMode({ disabled: true })).toBe("disabled")
    expect(toOrchestratorLanes([{ id: "1", title: "Sub", status: "busy" }])[0]?.status).toBe("active")
    expect(toApprovalDecision("approve")).toBe("once")
    expect(toApprovalDecision("reject")).toBe("reject")
  })
})
