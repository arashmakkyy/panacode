import { describe, expect, test } from "bun:test"
import { fromOpenCodeTool } from "./tool-call"

const mark = () => () => null as never

describe("fromOpenCodeTool", () => {
  test("shell call maps command, output, duration and a non-zero exit to an error", () => {
    const call = fromOpenCodeTool(
      {
        id: "t1",
        name: "bash",
        state: { status: "completed", input: { command: "ls -la" }, content: [{ type: "text", text: "a\nb\n" }], metadata: { exit: 2 } },
        time: { created: 1000, ran: 1100, completed: 2300 },
      },
      { mark },
    )
    expect(call.kind).toBe("shell")
    expect(call.title).toBe("Ran ls -la")
    expect(call.titles?.running).toBe("Running ls -la")
    expect(call.status).toBe("error")
    expect(call.message).toBe("Exited with code 2")
    expect(call.durationMs).toBe(1200)
    expect(call.output).toEqual({ type: "text", text: "a\nb" })
  })

  test("streaming input is parsed, paths are made relative, and running has no duration", () => {
    const call = fromOpenCodeTool(
      { id: "t2", name: "read", state: { status: "streaming", input: '{"filePath":"/repo/src/a.ts"}' }, time: { created: 1 } },
      { mark, root: "/repo" },
    )
    expect(call.status).toBe("running")
    expect(call.title).toBe("Read src/a.ts")
    expect(call.durationMs).toBeUndefined()
  })

  test("a rejected permission is denied and keeps no output", () => {
    const call = fromOpenCodeTool(
      {
        id: "t3",
        name: "edit",
        state: { status: "error", input: { filePath: "x" }, error: { type: "permission", message: "The user rejected permission to use this tool" } },
        time: { created: 1, completed: 2 },
      },
      { mark },
    )
    expect(call.status).toBe("denied")
    expect(call.output).toBeUndefined()
  })
})
