import { describe, expect, test } from "bun:test"
import { fromPermissionRequest, permissionRisk, toPermissionReply, type PermissionCopy } from "./agent-approvals"

const copy: PermissionCopy = {
  title: {
    shell: "Run {{target}}",
    edit: "Edit {{target}}",
    create: "Create {{target}}",
    read: "Read {{target}}",
    web: "Fetch {{target}}",
    directory: "Access {{target}}",
    tool: "Use {{target}}",
  },
  tool: (action) => ({ bash: "Bash", edit: "Edit" })[action],
  command: "Command",
  path: "Path",
  url: "URL",
  resource: "Resource",
  pattern: "Always allows",
  changes: "Changes",
}

describe("fromPermissionRequest", () => {
  test("shell commands are high risk with the command as a mono argument", () => {
    const card = fromPermissionRequest({ id: "p1", action: "bash", resources: ["git status"], save: ["git *"] }, copy)
    expect(card.risk).toBe("high")
    expect(card.title).toBe("Run `git status`")
    expect(card.args.map((a) => [a.label, a.value])).toEqual([
      ["Command", "git status"],
      ["Always allows", "bash git *"],
    ])
    expect(card.source).toBe("Bash")
  })

  test("a new file reads as Create with its diff size", () => {
    const card = fromPermissionRequest(
      {
        id: "p2",
        action: "edit",
        resources: ["/home/u/project/qa-check.txt"],
        save: ["*"],
        metadata: { files: [{ file: "qa-check.txt", additions: 1, deletions: 0, status: "added", patch: "" }] },
      },
      copy,
    )
    expect(card.risk).toBe("medium")
    expect(card.title).toBe("Create `qa-check.txt`")
    expect(card.args.find((a) => a.key === "changes")?.value).toBe("+1 −0")
    expect(card.args.find((a) => a.key === "resource")?.value).toBe("/home/u/project/qa-check.txt")
  })

  test("unknown tools fall back to the action name", () => {
    const card = fromPermissionRequest({ id: "p3", action: "mcp_deploy", resources: [] }, copy)
    expect(card.title).toBe("Use")
    expect(card.source).toBe("mcp_deploy")
    expect(permissionRisk("read")).toBe("low")
  })

  test("decisions map onto OpenCode replies", () => {
    expect(toPermissionReply("approved")).toBe("once")
    expect(toPermissionReply("always")).toBe("always")
    expect(toPermissionReply("denied")).toBe("reject")
  })
})
