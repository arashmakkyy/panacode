import { describe, expect, test } from "bun:test"
import { orchestratorLane, type ChildLike } from "./agent-orchestrator"
import type { RunToolLike } from "./agent-run"

const call = (status: RunToolLike["state"]["status"]): RunToolLike => ({
  type: "tool",
  id: "t1",
  name: "subagent",
  state: { status, input: { description: "Audit pricing", agent: "explore", prompt: "Read the pricing page" }, metadata: { sessionID: "c1" } },
  time: { created: 1000, ran: 1000 },
})
const opts = { toolLabel: (name: string) => (name === "read" ? "Reading" : name) }

describe("orchestrator lane", () => {
  test("a launched call with a running child is a working lane on its current tool", () => {
    const child: ChildLike = {
      running: true,
      messages: [
        { type: "user", time: { created: 1000 } },
        {
          type: "assistant",
          time: { created: 1100 },
          model: { id: "m1" },
          tokens: { input: 100, output: 20 },
          cost: 0.001,
          content: [{ type: "tool", id: "x", name: "read", state: { status: "running", input: { filePath: "/p/a.ts" } }, time: { created: 1200, ran: 1200 } }],
        },
      ],
    }
    const lane = orchestratorLane(call("completed"), child, { ...opts, root: "/p" })
    expect(lane.status).toBe("running")
    expect(lane.tool).toEqual({ name: "read", label: "Reading", target: "a.ts" })
    expect(lane.worker.name).toBe("explore · m1")
    expect(lane.tokens).toBe(120)
    expect(lane.log.map((entry) => entry.kind)).toEqual(["dispatch", "tool"])
  })

  test("a finished child returns with its last text as the result", () => {
    const child: ChildLike = {
      running: false,
      messages: [{ type: "assistant", time: { created: 1100, completed: 3100 }, content: [{ type: "text", text: "**Three** tiers.\n- Annual saving `hidden`." }] }],
    }
    const lane = orchestratorLane(call("completed"), child, opts)
    expect(lane.status).toBe("returned")
    expect(lane.result).toBe("Three tiers. Annual saving hidden.")
    expect(lane.endedAt).toBe(3100)
    expect(lane.progress).toBe(1)
  })

  test("a call still being written is planned", () => {
    expect(orchestratorLane(call("streaming"), undefined, opts).status).toBe("planned")
  })
})
