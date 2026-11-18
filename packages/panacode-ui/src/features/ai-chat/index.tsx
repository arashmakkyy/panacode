import { For, Show, type JSX } from "solid-js"
import "./ai-chat.css"

export type ChatRole = "user" | "assistant" | "system"

export type ChatMessageView = {
  id: string
  role: ChatRole
  content: JSX.Element
  streaming?: boolean
}

export interface AiChatProps {
  messages: readonly ChatMessageView[]
  empty?: JSX.Element
  footer?: JSX.Element
  class?: string
}

/** Presentation shell for session chat. Bind real session parts via the app adapter. */
export function AiChat(props: AiChatProps) {
  return (
    <div data-component="panacode-ai-chat" data-panacode-feature="ai-chat" class={props.class}>
      <div data-slot="chat-scroll">
        <Show when={props.messages.length > 0} fallback={<div data-slot="chat-empty">{props.empty}</div>}>
          <For each={props.messages}>
            {(message) => (
              <article data-slot="chat-message" data-role={message.role} data-streaming={message.streaming ? "" : undefined}>
                <div data-slot="chat-bubble">{message.content}</div>
              </article>
            )}
          </For>
        </Show>
      </div>
      <Show when={props.footer}>
        <div data-slot="chat-footer">{props.footer}</div>
      </Show>
    </div>
  )
}
