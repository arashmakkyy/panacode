import type { LaneLogEntry, LaneStatus, OrchestratorLaneView } from "../features/agent-orchestrator/types"
import { runToolTarget, type RunContentLike, type RunToolLike } from "./agent-run"

/** A child session's message as the lane reads it (structural, no client import). */
export type ChildMessageLike =
  | { type: "user"; time: { created: number } }
  | {
      type: "assistant"
      content: readonly RunContentLike[]
      time: { created: number; completed?: number }
      tokens?: { input: number; output: number; reasoning?: number }
      cost?: number
      error?: { type: string; message: string }
      model?: { id: string }
    }
  | { type: string; time?: { created: number } }

export type ChildLike = { messages: readonly ChildMessageLike[]; running: boolean }

export const isSubagentTool = (tool: { name: string }) => tool.name === "subagent" || tool.name === "task"

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {}
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim()
/** Lane lines are plain text: drop code fences, emphasis, headings and list marks. */
const plain = (value: string) =>
  value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*(?:[-*+]|\d+\.|#{1,6})\s+/gm, "")
    .replace(/[`*_>]/g, "")
const interrupted = (type?: string) => !!type && /abort|interrupt/i.test(type)

type Assistant = Extract<ChildMessageLike, { type: "assistant" }>
const assistantsOf = (messages: readonly ChildMessageLike[]) =>
  messages.filter((message): message is Assistant => message.type === "assistant" && "content" in message)

/** The child session a subagent call launched. */
export const subagentSessionID = (tool: RunToolLike) => str(record(tool.state.metadata).sessionID)

/**
 * One worker lane per subagent call: the call is the plan item, its child session is the worker. Status, tools,
 * output, tokens and cost all come from the child's real messages.
 */
export function orchestratorLane(
  tool: RunToolLike,
  child: ChildLike | undefined,
  options: { toolLabel: (name: string) => string; root?: string; worker?: (agent: string | undefined, model: string | undefined) => string },
): OrchestratorLaneView {
  const input = record(tool.state.input)
  const agent = str(input.agent)
  const title = str(input.description) ?? agent ?? tool.name
  const prompt = str(input.prompt)
  const assistants = assistantsOf(child?.messages ?? [])
  const content = assistants.flatMap((message) => message.content)
  const tools = content.filter((item): item is RunToolLike => item.type === "tool")
  const texts = content.flatMap((item) => (item.type === "text" && item.text.trim() ? [item.text] : []))
  const last = assistants.at(-1)
  const model = last?.model?.id
  const started = tool.time.ran ?? tool.time.created
  const lastError = [...assistants].reverse().find((message) => message.error)?.error

  let status: LaneStatus
  if (tool.state.status === "streaming") status = "planned"
  else if (tool.state.status === "error" && !child?.messages.length)
    status = interrupted(tool.state.error?.type) ? "stopped" : "gaveup"
  else if (child?.running) status = assistants.length ? "running" : "starting"
  else if (!child || !assistants.length) status = tool.state.status === "running" ? "starting" : "planned"
  else if (lastError && interrupted(lastError.type)) status = "stopped"
  else if (lastError) status = "gaveup"
  else if (last?.time.completed !== undefined) status = "returned"
  else status = "running"

  const current = status === "running" ? [...tools].reverse().find((item) => item.state.status === "running") : undefined
  const ended =
    status === "returned" || status === "gaveup" || status === "stopped"
      ? (last?.time.completed ?? last?.time.created)
      : undefined

  const log: LaneLogEntry[] = [{ at: 0, kind: "dispatch", text: clip(oneLine(prompt ?? title), 140) }]
  for (const item of content) {
    if (item.type === "tool") {
      const at = (item.time.ran ?? item.time.created) - started
      log.push({ at, kind: "tool", tool: item.name, text: runToolTarget(item, options.root) ?? "" })
      if (item.state.status === "error")
        log.push({ at: (item.time.completed ?? item.time.created) - started, kind: "error", text: clip(oneLine(item.state.error?.message ?? ""), 140) })
    }
  }
  for (const message of assistants) {
    const text = message.content.flatMap((item) => (item.type === "text" && item.text.trim() ? [item.text] : [])).join(" ")
    if (text) log.push({ at: (message.time.completed ?? message.time.created) - started, kind: message === last && status === "returned" ? "result" : "output", text: clip(oneLine(plain(text)), 160) })
    if (message.error && !interrupted(message.error.type)) log.push({ at: message.time.created - started, kind: "error", text: clip(oneLine(message.error.message), 140) })
  }
  log.sort((a, b) => a.at - b.at)

  const finalText = texts.length ? plain(texts.at(-1)!) : undefined
  const lastLine = finalText ? oneLine(finalText.split("\n").filter((line) => line.trim()).at(-1) ?? finalText) : ""
  const progress =
    status === "returned" || status === "gaveup" || status === "stopped"
      ? 1
      : status === "running"
        ? Math.min(0.9, 0.18 + tools.length * 0.12)
        : status === "starting"
          ? 0.08
          : 0

  return {
    id: tool.id,
    title,
    instruction: prompt ? clip(oneLine(prompt), 110) : undefined,
    worker: { name: options.worker?.(agent, model) ?? ([agent, model].filter(Boolean).join(" · ") || title) },
    status,
    tool: current ? { name: current.name, label: options.toolLabel(current.name), target: runToolTarget(current, options.root) } : undefined,
    line: lastLine,
    result: status === "returned" && finalText ? oneLine(finalText) : undefined,
    error: status === "gaveup" ? (lastError?.message ?? (tool.state.status === "error" ? tool.state.error?.message : undefined)) : undefined,
    toolCount: tools.length,
    tokens: assistants.reduce((sum, message) => sum + (message.tokens ? message.tokens.input + message.tokens.output + (message.tokens.reasoning ?? 0) : 0), 0),
    cost: assistants.reduce((sum, message) => sum + (message.cost ?? 0), 0),
    startedAt: status === "planned" ? undefined : started,
    endedAt: ended,
    log,
    progress,
  }
}

/** Old presentation helper, kept for callers of the stub API. */
export function toOrchestratorLanes(tasks: readonly { id: string; title: string; status: string }[]) {
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: /run|busy|progress|active/.test(task.status) ? "active" : /error|fail/.test(task.status) ? "error" : /pend|queue|idle/.test(task.status) ? "idle" : "done",
  }))
}
