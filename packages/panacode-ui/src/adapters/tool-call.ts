import type { ToolCallData, ToolCallOutput, ToolCallStatus, ToolCallValue } from "../features/tool-call"
import type { ToolMarkName } from "../features/tool-call/marks"

/** The fields of an OpenCode assistant tool part the Tool Call block reads. */
export type OpenCodeToolLike = {
  id: string
  name: string
  state:
    | { status: "streaming"; input: string }
    | { status: "running"; input: Record<string, unknown>; metadata?: Record<string, unknown> }
    | { status: "completed"; input: Record<string, unknown>; content?: ReadonlyArray<{ type: string; text?: string }>; metadata?: Record<string, unknown> }
    | {
        status: "error"
        input: Record<string, unknown>
        error: { type?: string; message: string }
        content?: ReadonlyArray<{ type: string; text?: string }>
        metadata?: Record<string, unknown>
      }
  time: { created: number; ran?: number; completed?: number }
}

export type ToolKind =
  | "shell"
  | "read"
  | "edit"
  | "write"
  | "patch"
  | "grep"
  | "glob"
  | "list"
  | "webfetch"
  | "websearch"
  | "subagent"
  | "todo"
  | "skill"
  | "execute"
  | "question"
  | "tool"

const renamed: Record<string, ToolKind> = {
  bash: "shell",
  shell: "shell",
  read: "read",
  edit: "edit",
  write: "write",
  patch: "patch",
  apply_patch: "patch",
  multiedit: "edit",
  grep: "grep",
  glob: "glob",
  list: "list",
  ls: "list",
  webfetch: "webfetch",
  websearch: "websearch",
  task: "subagent",
  subagent: "subagent",
  todowrite: "todo",
  todoread: "todo",
  skill: "skill",
  execute: "execute",
  question: "question",
}

export function toolKind(name: string): ToolKind {
  return renamed[name.toLowerCase()] ?? "tool"
}

export const toolKindMark: Record<ToolKind, ToolMarkName> = {
  shell: "terminal",
  read: "file",
  edit: "filePen",
  write: "filePlus",
  patch: "filePen",
  grep: "search",
  glob: "search",
  list: "folder",
  webfetch: "globe",
  websearch: "globe",
  subagent: "bot",
  todo: "listChecks",
  skill: "sparkles",
  execute: "code",
  question: "messageQuestion",
  tool: "plug",
}

/** Localized phrasing. `subject` is the file, command, pattern or URL the call is about (may be empty). */
export type ToolCallCopy = {
  name: (kind: ToolKind, raw: string) => string
  title: (kind: ToolKind, status: "running" | "done" | "approval", subject: string, raw: string) => string
  exitCode: (code: number) => string
  timedOut: string
  stopped: string
}

export const defaultToolCallCopy: ToolCallCopy = {
  name: (kind, raw) =>
    ({
      shell: "Shell",
      read: "Read",
      edit: "Edit",
      write: "Write",
      patch: "Patch",
      grep: "Search",
      glob: "Find files",
      list: "List",
      webfetch: "Fetch",
      websearch: "Web search",
      subagent: "Agent",
      todo: "Plan",
      skill: "Skill",
      execute: "Code",
      question: "Question",
      tool: raw,
    })[kind],
  title: (kind, status, subject, raw) => {
    const s = subject ? ` ${subject}` : ""
    const v = (done: string, running: string, approval = running) =>
      (status === "done" ? done : status === "running" ? running : approval) + s
    switch (kind) {
      case "shell":
        return v("Ran", "Running", "Run")
      case "read":
        return v("Read", "Reading", "Read")
      case "edit":
      case "patch":
        return v("Edited", "Editing", "Edit")
      case "write":
        return v("Created", "Creating", "Create")
      case "grep":
        return v("Searched for", "Searching for", "Search for")
      case "glob":
        return v("Found files matching", "Finding files matching", "Find files matching")
      case "list":
        return v("Listed", "Listing", "List")
      case "webfetch":
        return v("Fetched", "Fetching", "Fetch")
      case "websearch":
        return v("Searched the web for", "Searching the web for", "Search the web for")
      case "subagent":
        return v("Ran agent", "Running agent", "Run agent")
      case "todo":
        return status === "done" ? "Updated the plan" : "Updating the plan"
      case "skill":
        return v("Loaded skill", "Loading skill", "Load skill")
      case "execute":
        return v("Ran code", "Running code", "Run code")
      case "question":
        return status === "done" ? "Asked a question" : "Asking a question"
      case "tool":
        return v(`Used ${raw}`, `Using ${raw}`, `Use ${raw}`)
    }
  },
  exitCode: (code) => `Exited with code ${code}`,
  timedOut: "Timed out",
  stopped: "Stopped",
}

function parseInput(state: OpenCodeToolLike["state"]): Record<string, unknown> {
  if (state.status !== "streaming") return state.input ?? {}
  try {
    const value = JSON.parse(state.input)
    return value && typeof value === "object" ? value : {}
  } catch {
    return {}
  }
}

const str = (value: unknown) => (typeof value === "string" ? value : undefined)

/** Events retain the model's original argument names, including legacy file-tool spellings. */
export function fileToolPath(input: Readonly<Record<string, unknown>>): string | undefined {
  let target: string | undefined
  for (const key of ["path", "filePath", "file_path", "file"]) {
    if (!Object.hasOwn(input, key)) continue
    const value = input[key]
    if (typeof value !== "string" || !value.trim() || (target !== undefined && target !== value)) return
    target = value
  }
  return target
}

export function shortToolPath(path: string, root?: string) {
  if (!root) return path
  const windows = /^[A-Za-z]:[\\/]|^\\\\/.test(root)
  const normalize = (value: string) => windows ? value.replaceAll("\\", "/").toLowerCase() : value
  const prefix = normalize(root).replace(/\/+$/, "") + "/"
  return normalize(path).startsWith(prefix) ? path.slice(prefix.length) : path
}

/** What the call is about, for the title: the file, command, pattern, URL or agent description. */
export function toolSubject(kind: ToolKind, input: Record<string, unknown>, root?: string): string {
  const path = fileToolPath(input)
  switch (kind) {
    case "shell":
      return str(input.command) ?? ""
    case "read":
    case "edit":
    case "write":
    case "list":
      return path ? shortToolPath(path, root) : ""
    case "patch": {
      const files = Array.isArray(input.files) ? input.files.length : 0
      return path ? shortToolPath(path, root) : files ? `${files} files` : ""
    }
    case "grep":
    case "glob":
      return str(input.pattern) ?? ""
    case "webfetch":
      return str(input.url) ?? ""
    case "websearch":
      return str(input.query) ?? ""
    case "subagent":
      return str(input.description) ?? str(input.subagent_type) ?? ""
    case "skill":
      return str(input.name) ?? ""
    default:
      return ""
  }
}

const MAX_VALUE = 600

function toValue(value: unknown, depth = 0): ToolCallValue {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}…` : value
  if (typeof value === "number" || typeof value === "boolean") return value
  if (depth > 4) return "…"
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => toValue(item, depth + 1))
  if (typeof value === "object")
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toValue(v, depth + 1)]))
  return String(value)
}

function contentText(state: OpenCodeToolLike["state"]) {
  if (state.status === "running") return str(state.metadata?.output)
  if (!("content" in state) || !state.content) return undefined
  const text = state.content.flatMap((item) => (item.type === "text" && item.text ? [item.text] : [])).join("\n")
  return text || undefined
}

function toOutput(kind: ToolKind, text: string | undefined): ToolCallOutput | undefined {
  if (!text) return undefined
  const trimmed = text.replace(/\s+$/, "")
  if ((kind === "glob" || kind === "list") && trimmed.includes("\n")) {
    const lines = trimmed.split("\n").filter((line) => line.trim())
    if (lines.length <= 200) return { type: "list", items: lines.map((line) => ({ title: line.trim() })) }
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { type: "json", value: toValue(JSON.parse(trimmed)) }
    } catch {
      /* plain text */
    }
  }
  return { type: "text", text: trimmed.length > 20000 ? `${trimmed.slice(0, 20000)}\n…` : trimmed }
}

function isStopped(state: OpenCodeToolLike["state"]) {
  if (state.status !== "error") return false
  const error = state.error
  return error.message === "Command cancelled" || /abort|interrupt/i.test(error.type ?? "")
}

function isDenied(state: OpenCodeToolLike["state"]) {
  if (state.status !== "error") return false
  return /permission|rejected|denied/i.test(`${state.error.type ?? ""} ${state.error.message}`) && /reject|denied/i.test(state.error.message)
}

/** A completed tool invocation can still report failure from the shell process. */
export function shellFailure(name: string, metadata?: Record<string, unknown>) {
  if (toolKind(name) !== "shell" || !metadata) return
  if (metadata.timeout === true || metadata.status === "timeout") return "timeout"
  if (metadata.interrupted === true || metadata.killed === true || metadata.status === "killed") return "stopped"
  if (typeof metadata.exit === "number" && metadata.exit !== 0) return "exit"
  if (typeof metadata.signal === "string" && metadata.signal) return "signal"
}

export function toToolCallStatus(tool: OpenCodeToolLike, approval = false): ToolCallStatus {
  if (approval) return "approval"
  const state = tool.state
  if (state.status === "streaming" || state.status === "running") return "running"
  if (state.status === "error") return isDenied(state) ? "denied" : "error"
  if (shellFailure(tool.name, state.metadata)) return "error"
  return "success"
}

/** Maps one OpenCode tool part to the Tool Call block's data. Nothing is invented: absent fields stay absent. */
export function fromOpenCodeTool(
  tool: OpenCodeToolLike,
  options: { copy?: ToolCallCopy; root?: string; approval?: boolean; mark: (name: ToolMarkName) => ToolCallData["tool"]["mark"] },
): ToolCallData & { kind: ToolKind } {
  const copy = options.copy ?? defaultToolCallCopy
  const kind = toolKind(tool.name)
  const input = parseInput(tool.state)
  const subject = toolSubject(kind, input, options.root)
  const status = toToolCallStatus(tool, options.approval)
  const state = tool.state
  const meta = ("metadata" in state ? state.metadata : undefined) ?? {}
  const failure = state.status === "completed" ? shellFailure(tool.name, meta) : undefined
  const message = state.status === "error"
    ? isStopped(state) ? copy.stopped : state.error.message
    : failure === "timeout" ? copy.timedOut
    : failure === "stopped" ? copy.stopped
    : failure === "exit" && typeof meta.exit === "number" ? copy.exitCode(meta.exit)
    : failure === "signal" ? str(meta.signal)
    : undefined
  const start = tool.time.ran ?? tool.time.created
  const durationMs = tool.time.completed && start ? Math.max(0, tool.time.completed - start) : undefined
  const entries = Object.entries(input)
  return {
    id: tool.id,
    kind,
    tool: { key: kind === "tool" ? `tool:${tool.name}` : kind, name: copy.name(kind, tool.name), mark: options.mark(toolKindMark[kind]) },
    title: state.status === "error"
      ? [copy.name(kind, tool.name), subject].filter(Boolean).join(" ")
      : copy.title(kind, "done", subject, tool.name),
    titles: {
      running: copy.title(kind, "running", subject, tool.name),
      approval: copy.title(kind, "approval", subject, tool.name),
    },
    status,
    input: entries.length ? Object.fromEntries(entries.map(([key, value]) => [key, toValue(value)])) : undefined,
    output: status === "denied" ? undefined : toOutput(kind, contentText(state)),
    message,
    durationMs,
  }
}
