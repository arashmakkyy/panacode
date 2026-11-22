export * as SessionRecentText from "./recent-text.js"

import type { SessionMessage } from "./message.js"
import type { SessionStored } from "./stored.js"

const TOOL_OUTPUT_MAX_CHARS = 1_250
// Includes the producer's 2048-character parse excerpt and the recovery instructions around it.
const REJECTED_FEEDBACK_MAX_CHARS = 4096

// Rejected calls stay intact on disk. Only the history sent back to the model is shortened,
// including the old validation format that embedded the entire file in its error message.
export function rejectedCall(
  tool: Pick<SessionMessage.AssistantTool, "name" | "executed">,
  state: Pick<SessionMessage.ToolStateError, "input" | "error">,
) {
  const original = state.error.message
  const legacy = state.error.type === "tool.execution" &&
    original.startsWith(`Invalid arguments for tool "${tool.name}":\n`) &&
    original.includes("\n\nArguments provided:\n") &&
    original.endsWith("\n\nUpdate the arguments and call the tool again.")
  const legacyShell = tool.name === "shell" && state.error.type === "unknown" &&
    original === "Portable shell scanner cannot analyze command: invalid-structure"
  if (tool.executed || !(legacy || legacyShell || state.error.type.startsWith("tool.input"))) return state
  const input = state.input
  const oversized = JSON.stringify(input).length > 2048
  // Keep only explicitly supplied short file destinations when the argument echo itself is too large.
  const retained = oversized ? Object.fromEntries(
    Object.entries(input).filter(([key, value]) =>
      ["path", "filePath", "file_path"].includes(key) && typeof value === "string" && value.length <= 512),
  ) : input
  const brief = legacy ? original.slice(0, original.indexOf("\n\nArguments provided:\n")) : original
  if (!oversized && brief === original && brief.length <= REJECTED_FEEDBACK_MAX_CHARS) return state
  const message = brief.length > REJECTED_FEEDBACK_MAX_CHARS ? brief.slice(0, REJECTED_FEEDBACK_MAX_CHARS) + "…" : brief
  return { input: retained, error: { ...state.error, message } }
}

/**
 * The text of the messages a summary compaction kept verbatim. History rebuilds it from `metadata.keepID`;
 * compactions written before that reference carry the text they stored.
 */
export const kept = (message: SessionMessage.CompactionCompleted) =>
  typeof message.metadata?.recent === "string" ? message.metadata.recent : ""

/** One message as the recent, verbatim part of a summary shows it. Empty for messages that part leaves out. */
export const messageToText = (message: SessionMessage.Info | SessionStored.User): string => {
  switch (message.type) {
    // Earlier summaries and instruction updates are handled outside the recent part.
    case "compaction":
    case "system":
      return ""

    case "user": {
      const skills =
        message.skills?.flatMap((skill) =>
          skill.text === undefined ? [] : [`[Skill activated: ${skill.name}]\n${skill.text}`],
        ) ?? []
      const files =
        message.files?.map((file) => {
          const name = file.name ?? (file.source.type === "uri" ? file.source.uri : "inline attachment")
          return `[Attached ${file.mime}: ${name}]`
        }) ?? []
      return [...skills, `[User]: ${message.text}`, ...files].join("\n")
    }

    case "location-switched":
      return `[User]: The working directory has been changed to ${message.location.directory}.`

    case "assistant":
      return message.content
        .flatMap((part) => {
          if (part.type === "text") return [`[Assistant]: ${part.text}`]
          // Providers return summaries of the real reasoning, and written out as text it can read like an attempt to
          // extract the model's thinking.
          if (part.type === "reasoning") return []

          const failure = part.state.status === "error" ? rejectedCall(part, part.state) : undefined
          const args = failure?.input ?? part.state.input
          const input = typeof args === "string" ? args : JSON.stringify(args)
          const call = `[Assistant tool call]: ${part.name}(${input})`
          if (part.state.status === "completed") {
            return [call, `[Tool result]: ${truncateToolOutput(serializeToolContent(part.state.content))}`]
          }
          if (failure) return [call, `[Tool error]: ${failure.error.message}`]
          return [call]
        })
        .join("\n")

    case "synthetic":
      return `[Synthetic context]: ${message.text}`

    case "skill":
      return `[Skill activated: ${message.name}]\n${message.text}`

    case "shell":
      if (message.metadata?.background === true) return ""
      return `[Shell]: ${message.command}\n${truncateToolOutput(message.output?.output ?? "")}`

    default:
      return ""
  }
}

export const truncateToolOutput = (value: string) => {
  if (value.length <= TOOL_OUTPUT_MAX_CHARS) return value

  // Count code points so a surrogate pair is never split.
  let end = 0
  let kept = 0
  for (const char of value) {
    if (kept === TOOL_OUTPUT_MAX_CHARS) break
    end += char.length
    kept++
  }
  if (end === value.length) return value
  return `${value.slice(0, end)}\n[truncated]`
}

export const serializeToolContent = (content: ReadonlyArray<SessionMessage.ToolStateCompleted["content"][number]>) =>
  content
    .map((item) => {
      if (item.type === "text") return item.text
      return `[Attached ${item.mime}${item.name === undefined ? "" : `: ${item.name}`}]`
    })
    .join("\n")
