import { describe, expect, test } from "bun:test"
import { changedFile, patchToLines, runChecks, runReply, runSteps, settledRun, type RunContentLike } from "./agent-run"

const patch = `Index: a.ts
===================================================================
--- a.ts
+++ a.ts
@@ -1,3 +1,3 @@
 const a = 1
-const b = 2
+const b = 3
 
`

describe("agent run adapter", () => {
  test("parses a unified diff with line numbers", () => {
    const lines = patchToLines(patch)
    expect(lines).toEqual([
      { type: "ctx", old: 1, new: 1, text: "const a = 1" },
      { type: "del", old: 2, text: "const b = 2" },
      { type: "add", new: 2, text: "const b = 3" },
      { type: "ctx", old: 3, new: 3, text: "" },
    ])
    expect(changedFile("a.ts", lines)).toEqual({ path: "a.ts", additions: 1, deletions: 1 })
  })

  test("maps a turn onto steps with waiting, rejected and terminal output", () => {
    const content: RunContentLike[] = [
      { type: "reasoning", text: "plan it", time: { created: 0, completed: 1200 } },
      { type: "tool", id: "r", name: "read", state: { status: "completed", input: { filePath: "/p/src/a.ts" }, content: [{ type: "text", text: "x" }] }, time: { created: 1000, ran: 1000, completed: 1300 } },
      { type: "tool", id: "e", name: "edit", state: { status: "running", input: { filePath: "/p/src/a.ts" } }, time: { created: 1400 } },
      { type: "tool", id: "w", name: "write", state: { status: "error", input: { filePath: "/p/b.ts" }, error: { message: "The user rejected permission" } }, time: { created: 1500, completed: 1600 } },
      { type: "tool", id: "b", name: "bash", state: { status: "completed", input: { command: "bun test" }, content: [{ type: "text", text: "ok" }], metadata: { exit: 1 } }, time: { created: 1700, completed: 2700 } },
      { type: "text", text: "done" },
    ]
    const steps = runSteps(content, { root: "/p", waiting: (id) => id === "e", notes: { w: "keep it" } })
    expect(steps.map((step) => [step.mark, step.status, step.target])).toEqual([
      ["think", "done", undefined],
      ["read", "done", "src/a.ts"],
      ["edit", "waiting", "src/a.ts"],
      ["edit", "rejected", "b.ts"],
      ["terminal", "failed", "bun test"],
    ])
    expect(steps[0]?.durationMs).toBe(1200)
    expect(steps[3]?.reason).toBe("keep it")
    expect(steps[3]?.doneVerb).toBe("Write")
    expect(steps[4]?.io).toEqual({ input: "$ bun test", output: "ok" })
    expect(runChecks(content)).toEqual([{ label: "bun test", passed: false }])
  })

  test("a timeout cannot turn green even if the shell returned zero", () => {
    const content: RunContentLike[] = [{
      type: "tool", name: "shell", id: "t", time: { created: 1, completed: 2 },
      state: { status: "completed", input: { command: "command" }, metadata: { timeout: true, exit: 0 } },
    }]
    expect(runSteps(content)[0]?.status).toBe("failed")
    expect(runChecks(content)[0]?.passed).toBe(false)
    const shell = content[0]!
    if (shell.type !== "tool") throw new Error("expected a shell call")
    expect(runChecks([{ ...shell, state: { ...shell.state, metadata: {} } }])).toEqual([])
    expect(runSteps([{ ...shell, state: { ...shell.state, metadata: { signal: "SIGTERM" } } }])[0]?.status).toBe("failed")
  })

  test("the terminal event determines the outcome even if an earlier tool or assistant recovered", () => {
    const assistant = { type: "assistant", time: { created: 1, completed: 2 } }
    const failed = { ...assistant, error: { type: "api_error", message: "Request too large" } }
    const idle = { type: "idle", time: { created: 4 } }
    expect(settledRun([assistant, { ...idle, outcome: "failed", error: failed.error }])).toMatchObject({
      status: "failed", endedAt: 4, error: "Request too large",
    })
    expect(settledRun([failed, { ...idle, outcome: "succeeded" }])?.status).toBe("done")
    expect(settledRun([assistant, { ...idle, outcome: "interrupted" }])?.status).toBe("stopped")
    expect(settledRun([failed])?.status).toBe("failed")
    expect(settledRun([{ ...assistant, error: { type: "aborted" } }, assistant])?.status).toBe("done")
    expect(settledRun([{ ...assistant, finish: "length" }])?.status).toBe("failed")
    expect(settledRun([assistant, { type: "compaction", status: "failed", error: failed.error }])?.status).toBe("failed")
    expect(settledRun([{ type: "assistant", time: { created: 1 } }])).toBeUndefined()
  })

  test("an announced write followed by a tool call is not the final answer", () => {
    const promise: RunContentLike = { type: "text", text: "Let me rewrite the file." }
    const write: RunContentLike = {
      type: "tool", id: "w", name: "write", time: { created: 1 },
      state: { status: "error", input: {}, error: { message: "Missing path" } },
    }
    expect(runReply([promise, write])).toBe("")
    expect(runReply([promise, write, { type: "text", text: "Working", native: { phase: "commentary" } }])).toBe("")
    expect(runReply([promise, write, { type: "text", text: "Recovered" }])).toBe("Recovered")
  })
})
