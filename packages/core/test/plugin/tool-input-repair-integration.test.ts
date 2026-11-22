import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { Agent } from "@opencode/core/agent"
import { Plugin } from "@opencode/core/plugin"
import { ToolInputRepairPlugin } from "@opencode/core/plugin/tool-input-repair"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { ReadTool } from "@opencode/core/tool/plugin/read"
import { WriteTool } from "@opencode/core/tool/plugin/write"
import { EditTool } from "@opencode/core/tool/plugin/edit"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const identity = {
  sessionID: Session.ID.make("ses_repair"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_repair"),
}

it.effect("repairs tool input before validating its original schema", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    const executed: unknown[] = []
    yield* plugins.activate([
      { ...ToolInputRepairPlugin.Plugin, revision: "1" },
      {
        id: "repairable-tool",
        revision: "1",
        effect: (ctx) =>
          ctx.tool.transform((draft) =>
            draft.add({
              name: "repairable",
              options: { codemode: false },
              description: "Repairable",
              input: Schema.Struct({ count: Schema.Int, enabled: Schema.Boolean }),
              execute: (input) => Effect.sync(() => executed.push(input)).pipe(Effect.as({ content: "ok" })),
            }),
          ),
      },
    ])
    const snapshot = yield* registry.snapshot()
    yield* snapshot.execute({
      ...identity,
      call: {
        type: "tool-call",
        id: "call-repair",
        name: "repairable",
        input: '{"count":"2","enabled":"true","extra":true}',
      },
    })
    expect(executed).toEqual([{ count: 2, enabled: true }])

    yield* registry.transform((draft) => {
      draft.update("repairable", (tool) => {
        tool.input = Schema.Struct({ count: Schema.Boolean, enabled: Schema.Boolean })
      })
    })
    const updated = yield* registry.snapshot()
    yield* updated.execute({
      ...identity,
      call: {
        type: "tool-call",
        id: "call-updated",
        name: "repairable",
        input: { count: "false", enabled: "true" },
      },
    })
    expect(executed).toEqual([
      { count: 2, enabled: true },
      { count: false, enabled: true },
    ])

    yield* registry.transform((draft) => draft.remove("repairable"))
    const removed = yield* registry.snapshot()
    expect(
      (yield* removed
        .execute({
          ...identity,
          call: { type: "tool-call", id: "call-removed", name: "repairable", input: {} },
        })
        .pipe(Effect.flip)).message,
    ).toBe('No tool named "repairable" is currently available. Please use a tool from the available tool list.')
  }),
)

it.effect("runs a call to another harness's tool name as the matching tool and says so", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    const executed: unknown[] = []
    yield* plugins.activate([
      { ...ToolInputRepairPlugin.Plugin, revision: "1" },
      {
        id: "shell-tool",
        revision: "1",
        effect: (ctx) =>
          ctx.tool.transform((draft) =>
            draft.add({
              name: "shell",
              options: { codemode: false },
              description: "Shell",
              input: Schema.Struct({ command: Schema.String, timeout: Schema.optionalKey(Schema.Int) }),
              execute: (input) => Effect.sync(() => executed.push(input)).pipe(Effect.as({ content: "done" })),
            }),
          ),
      },
    ])
    const snapshot = yield* registry.snapshot()
    const result = yield* snapshot.execute({
      ...identity,
      call: { type: "tool-call", id: "call-bash", name: "bash", input: { command: "ls", timeout: "5000" } },
    })
    expect(executed).toEqual([{ command: "ls", timeout: 5000 }])
    expect(result.content).toEqual([
      { type: "text", text: "done" },
      { type: "text", text: 'There is no "bash" tool, so this ran as "shell". Call "shell" directly.' },
    ])

    const invalid = yield* snapshot.execute({
      ...identity,
      call: { type: "tool-call", id: "invalid-bash", name: "bash", input: { timeout: "50" } },
    }).pipe(Effect.flip)
    expect(toSessionError(invalid)).toMatchObject({ type: "tool.input-schema", message: expect.stringContaining("command: Missing key") })
    expect(executed).toHaveLength(1)

    const direct = yield* snapshot.execute({
      ...identity,
      call: { type: "tool-call", id: "call-shell", name: "shell", input: { command: "pwd" } },
    })
    expect(direct.content).toEqual([{ type: "text", text: "done" }])
  }),
)

it.effect("repairs namespaced inner tool input called from Code Mode", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    const executed: unknown[] = []
    yield* plugins.activate([{ ...ToolInputRepairPlugin.Plugin, revision: "1" }])
    yield* registry.transform((draft) =>
      draft.add({
        name: "count",
        options: { namespace: "example" },
        description: "Record a count",
        input: Schema.Struct({ count: Schema.Int }),
        execute: (input) => Effect.sync(() => executed.push(input)).pipe(Effect.as({ content: "ok" })),
      }),
    )

    const snapshot = yield* registry.snapshot()
    yield* snapshot.execute({
      ...identity,
      call: {
        type: "tool-call",
        id: "call-codemode-repair",
        name: "execute",
        input: { code: 'return await tools.example.count({ count: "3" })' },
      },
    })
    expect(executed).toEqual([{ count: 3 }])
  }),
)

it.effect("recovers explicit file path aliases without guessing, mixing targets, or changing file bytes", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    const calls: unknown[] = []
    yield* plugins.activate([{ ...ToolInputRepairPlugin.Plugin, revision: "1" }])
    yield* registry.transform((draft) => {
      for (const [name, input] of [["read", ReadTool.Input], ["write", WriteTool.Input], ["edit", EditTool.Input]] as const) {
        draft.add({
          name, input, description: name, options: { codemode: false },
          execute: (value) => Effect.sync(() => { calls.push(value) }).pipe(Effect.as({ content: "ok" })),
        })
      }
    })
    const snapshot = yield* registry.snapshot()
    let index = 0
    const invoke = (name: string, input: unknown) => snapshot.execute({
      ...identity, call: { type: "tool-call", id: `file-call-${++index}`, name, input },
    })
    const path = "صفحه/index.html"
    const content = ("<p dir=\"rtl\">سلام \\ دنیا</p>\r\n").repeat(1100)
    const untouched = { filePath: path, content }
    yield* invoke("write", untouched)
    yield* invoke("read", JSON.stringify({ file_path: path, limit: "15" }))
    yield* invoke("edit", { file: path, oldString: "سلام", newString: "درود" })
    yield* invoke("read", { path, filePath: path, file_path: path })
    expect(calls).toEqual([{ path, content }, { path, limit: 15 }, { path, oldString: "سلام", newString: "درود" }, { path }])
    expect(untouched).toEqual({ filePath: path, content })

    const missing = yield* invoke("write", { content }).pipe(Effect.flip)
    expect(toSessionError(missing).type).toBe("tool.input-schema")
    expect(missing.message).toContain("path: Missing key")
    expect(missing.message).not.toContain(content.slice(0, 12))
    expect(missing.message.length).toBeLessThan(500)
    for (const path of ["", "   "]) {
      const empty = yield* invoke("read", { path }).pipe(Effect.flip)
      expect(toSessionError(empty).type).toBe("tool.input-schema")
      expect(empty.message).toContain("nonempty path")
    }
    for (const bad of [
      { path, filePath: "another.html" }, { file_path: path, file: "another.html" },
      { filePath: null }, { filePath: " " }, { filePath: [path] },
    ]) {
      const failure = yield* invoke("write", { ...bad, content }).pipe(Effect.flip)
      expect(toSessionError(failure).type).toBe("tool.input-schema")
      expect(failure.message).toContain("one explicit file path")
    }
    expect(calls).toHaveLength(4)
    yield* registry.transform((draft) => draft.update("write", (entry) => {
      entry.input = Schema.Struct({ destination: Schema.String, payload: Schema.String })
    }))
    const updated = yield* registry.snapshot()
    const changed = yield* updated.execute({ ...identity, call: {
      type: "tool-call", id: "replacement", name: "write", input: { filePath: path, content },
    } }).pipe(Effect.flip)
    expect(changed.message).toContain("destination: Missing key")
    // The old snapshot still owns the native write schema even after a replacement is registered.
    yield* invoke("write", { filePath: path, content })
    expect(calls).toHaveLength(5)
    expect(calls.at(-1)).toEqual({ path, content })
  }),
)
