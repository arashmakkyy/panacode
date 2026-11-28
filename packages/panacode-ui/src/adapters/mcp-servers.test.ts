import { parseMcpCommand } from "../features/mcp-servers/command"
import { describe, expect, test } from "bun:test"
import { toMcpServerViews } from "./mcp-servers"
import { toToolCallStatus } from "./tool-call"
import { toAgentRunStatus } from "./agent-run"
import { toComposerMode } from "./ai-composer"
import { toOrchestratorLanes } from "./agent-orchestrator"
import { toApprovalDecision } from "./agent-approvals"

describe("panacode adapters", () => {
  test("maps MCP server status, config and resources into rows", () => {
    const rows = toMcpServerViews(
      [
        { name: "github", status: { status: "connected" } },
        { name: "broken", status: { status: "failed", error: "timeout" } },
        { name: "off", status: { status: "disabled" } },
        { name: "slow", status: { status: "connected" } },
      ],
      {
        config: (name) =>
          name === "github"
            ? { type: "remote", url: "https://user:pw@api.githubcopilot.com/mcp/?token=secret" }
            : { type: "local", command: ["npx", "-y", "@acme/server", "--key", "secret"] },
        resources: [{ server: "github", name: "README", uri: "repo://readme" }],
        busy: (name) => name === "slow",
      },
    )
    expect(rows.map((row) => row.status)).toEqual(["connected", "error", "disabled", "connecting"])
    expect(rows[0]).toMatchObject({ brand: "github", transport: "remote", endpoint: "https://api.githubcopilot.com/mcp/" })
    expect(rows[0]?.resources).toEqual([{ name: "README", uri: "repo://readme", description: undefined }])
    expect(rows[1]).toMatchObject({ transport: "local", endpoint: "npx -y", error: "timeout" })
    expect(JSON.stringify(rows)).not.toContain("secret")
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

test.each([
  ['node "/demo/My Tools/service.js" --label "two words"', ["node", "/demo/My Tools/service.js", "--label", "two words"]],
  ['"C:\\Program Files\\node.exe" "C:\\Users\\user\\my server.js" --empty ""', ["C:\\Program Files\\node.exe", "C:\\Users\\user\\my server.js", "--empty", ""]],
  ["node one\\ two 'سه چهار'", ["node", "one two", "سه چهار"]],
  ["node 'unfinished", undefined], [" ", undefined], ["https://example.test", undefined],
] as const)("parses a local command as literal argv: %s", (command, expected) => {
  expect(parseMcpCommand(command)).toEqual(expected)
})
