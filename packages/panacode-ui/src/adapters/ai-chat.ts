import type { ChatMessageView, ChatRole } from "../features/ai-chat"
import type { JSX } from "solid-js"

/** Maps OpenCode session message summaries into Panacode AiChat presentation props. */
export function toChatMessageViews(
  messages: readonly {
    id: string
    role: string
    content: JSX.Element
    streaming?: boolean
  }[],
): ChatMessageView[] {
  return messages.map((message) => ({
    id: message.id,
    role: normalizeRole(message.role),
    content: message.content,
    streaming: message.streaming,
  }))
}

function normalizeRole(role: string): ChatRole {
  if (role === "user" || role === "assistant" || role === "system") return role
  return "assistant"
}
