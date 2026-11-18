import type { AgentStep, ChangedFile, DiffLine, RunCheck, StepMark } from "../features/agent-run/types"

/** The OpenCode assistant content the run reads (structural, no client import). */
export type RunToolLike = {
  type: "tool"
  id: string
  name: string
  state: {
    status: "streaming" | "running" | "completed" | "error"
    input: unknown
    content?: readonly { type: string; text?: string }[]
    error?: { message: string; type?: string }
    metadata?: { [key: string]: unknown }
  }
  time: { created: number; ran?: number; completed?: number }
}
export type RunReasoningLike = { type: "reasoning"; text: string; time?: { created: number; completed?: number } }
export type RunTextLike = { type: "text"; text: string }
export type RunContentLike = RunToolLike | RunReasoningLike | RunTextLike

export type RunStepCopy = {
  /** [running, done] verbs per mark. */
  verbs: Record<StepMark | "write" | "plan", [string, string]>
}

export const defaultRunStepCopy: RunStepCopy = {
  verbs: {
    think: ["Thinking", "Thought"],
    read: ["Reading", "Read"],
    search: ["Searching", "Searched"],
    edit: ["Editing", "Edited"],
    write: ["Writing", "Wrote"],
    terminal: ["Running", "Ran"],
    review: ["Reviewing", "Reviewed"],
    web: ["Fetching", "Fetched"],
    task: ["Delegating", "Delegated"],
    plan: ["Planning", "Updated plan"],
    tool: ["Calling", "Called"],
  },
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {}
const text = (value: unknown) => (typeof value === "string" ? value : undefined)
const base = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path
const clip = (value: string, max = 80) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)
const firstLine = (value: string) => value.split("\n")[0] ?? value

/** Which Arc step a tool is, and its verb pair key. */
export function runToolKind(name: string): { mark: StepMark; verb: keyof RunStepCopy["verbs"] } {
  const n = name.toLowerCase()
  if (n === "read" || n === "view") return { mark: "read", verb: "read" }
  if (n === "write") return { mark: "edit", verb: "write" }
  if (n === "edit" || n === "multiedit" || n === "patch" || n === "apply_patch") return { mark: "edit", verb: "edit" }
  if (n === "glob" || n === "grep" || n === "list" || n === "ls" || n === "codesearch") return { mark: "search", verb: "search" }
  if (n === "bash" || n === "shell") return { mark: "terminal", verb: "terminal" }
  if (n === "webfetch" || n === "websearch" || n === "fetch") return { mark: "web", verb: "web" }
  if (n === "task" || n === "subagent") return { mark: "task", verb: "task" }
  if (n === "todowrite" || n === "todoread") return { mark: "review", verb: "plan" }
  return { mark: "tool", verb: "tool" }
}

/** A short subject for the step row: a file name, a pattern, a command or a host. */
export function runToolTarget(tool: RunToolLike, root?: string): string | undefined {
  const input = record(tool.state.input)
  const path = text(input.filePath) ?? text(input.path) ?? text(input.file)
  const { mark } = runToolKind(tool.name)
  if (mark === "read" || mark === "edit") return path ? relative(path, root) : undefined
  if (mark === "search") return text(input.pattern) ?? text(input.query) ?? (path ? relative(path, root) : undefined)
  if (mark === "terminal") {
    const command = text(input.command)
    return command ? clip(firstLine(command), 72) : text(input.description)
  }
  if (mark === "web") {
    const url = text(input.url)
    if (url) {
      try {
        return new URL(url).host
      } catch {
        return clip(url, 60)
      }
    }
    return text(input.query)
  }
  if (mark === "task") return text(input.description)
  if (mark === "tool") return tool.name
  return undefined
}

function relative(path: string, root?: string) {
  const clean = root?.replace(/[\\/]+$/, "")
  if (clean && path.startsWith(clean + "/")) return path.slice(clean.length + 1)
  return base(path)
}

const outputText = (tool: RunToolLike) =>
  (tool.state.content ?? [])
    .flatMap((item) => (item.type === "text" && item.text ? [item.text] : []))
    .join("\n")

/** Maps one assistant turn's content onto Arc steps, in order. */
export function runSteps(
  content: readonly RunContentLike[],
  options: {
    copy?: RunStepCopy
    root?: string
    /** Tool call ids waiting on the user right now. */
    waiting?: (callID: string) => boolean
    /** Notes sent back with rejections, by tool call id. */
    notes?: Record<string, string>
    now?: number
  } = {},
): AgentStep[] {
  const copy = options.copy ?? defaultRunStepCopy
  return content.flatMap((item, index): AgentStep[] => {
    if (item.type === "reasoning") {
      if (!item.text.trim()) return []
      const done = item.time?.completed !== undefined
      return [
        {
          id: `reasoning-${index}`,
          mark: "think",
          verb: copy.verbs.think[0],
          doneVerb: copy.verbs.think[1],
          status: done || !item.time ? "done" : "running",
          startedAt: item.time?.created,
          durationMs: item.time?.completed !== undefined ? item.time.completed - item.time.created : undefined,
          text: item.text.trim(),
        },
      ]
    }
    if (item.type !== "tool") return []
    const kind = runToolKind(item.name)
    const verbs = copy.verbs[kind.verb]
    const state = item.state
    const started = item.time.ran ?? item.time.created
    const waiting = options.waiting?.(item.id) ?? false
    const note = options.notes?.[item.id]
    const status: AgentStep["status"] = waiting
      ? "waiting"
      : state.status === "completed"
        ? "done"
        : state.status === "error"
          ? note || /reject|denied|declin/i.test(state.error?.message ?? "")
            ? "rejected"
            : "failed"
          : "running"
    const input = record(state.input)
    const io =
      kind.mark === "terminal" && typeof input.command === "string"
        ? { input: `$ ${input.command}`, output: clip(outputText(item) || state.error?.message || "", 4000) }
        : undefined
    return [
      {
        id: item.id,
        mark: kind.mark,
        verb: verbs[0],
        doneVerb: verbs[1],
        target: runToolTarget(item, options.root),
        status,
        startedAt: started,
        durationMs: item.time.completed !== undefined ? Math.max(0, item.time.completed - started) : undefined,
        io,
        text: io ? undefined : status === "failed" ? state.error?.message : undefined,
        reason: note,
      },
    ]
  })
}

/** The commands a run executed, with how each exited. Only real exits count; nothing is invented. */
export function runChecks(content: readonly RunContentLike[]): RunCheck[] {
  return content.flatMap((item): RunCheck[] => {
    if (item.type !== "tool" || runToolKind(item.name).mark !== "terminal") return []
    if (item.state.status !== "completed" && item.state.status !== "error") return []
    const command = text(record(item.state.input).command)
    if (!command) return []
    const exit = record(item.state.metadata).exit
    const passed = item.state.status === "completed" && (typeof exit !== "number" || exit === 0)
    return [{ label: clip(firstLine(command), 48), passed }]
  })
}

/** Parses a unified diff into Arc diff lines with old and new line numbers. */
export function patchToLines(patch: string): DiffLine[] {
  const lines: DiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let inHunk = false
  for (const raw of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (header) {
      oldLine = Number(header[1])
      newLine = Number(header[2])
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (raw.startsWith("\\")) continue
    if (raw.startsWith("+")) lines.push({ type: "add", new: newLine++, text: raw.slice(1) })
    else if (raw.startsWith("-")) lines.push({ type: "del", old: oldLine++, text: raw.slice(1) })
    // A real blank context line is a single space; a bare empty line only closes the patch.
    else if (raw.startsWith(" ")) lines.push({ type: "ctx", old: oldLine++, new: newLine++, text: raw.slice(1) })
  }
  return lines
}

/** Totals per file from Arc diff lines. */
export function changedFile(path: string, lines: DiffLine[]): ChangedFile {
  return {
    path,
    additions: lines.filter((line) => line.type === "add").length,
    deletions: lines.filter((line) => line.type === "del").length,
  }
}

/** Kept for older callers: OpenCode status words onto the run status. */
export function toAgentRunStatus(status: string | undefined): "working" | "waiting" | "done" | "stopped" {
  switch (status) {
    case "queued":
    case "pending":
    case "running":
    case "in_progress":
    case "busy":
      return "working"
    case "waiting":
      return "waiting"
    case "error":
    case "failed":
    case "cancelled":
    case "aborted":
      return "stopped"
    default:
      return "done"
  }
}
