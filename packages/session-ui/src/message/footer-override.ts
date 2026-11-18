import type { Component } from "solid-js"
import type { SessionMessageAssistant } from "@opencode/client/promise"
import type { TurnSources } from "../sources/sources"

/** The footer under a turn's final reply text: copy, retry, sources and the quiet meta. */
export type TextFooterProps = {
  id: string
  text: string
  message: SessionMessageAssistant
  turnDurationMs?: number | null
  turnTokensPerSecond?: number
  sources?: TurnSources
  onOpenSources?: () => void
  /** Rewinds to this turn's prompt and sends it again; only set on the newest turn. */
  onRetry?: () => Promise<void> | void
  interrupted: boolean
}

let footer: Component<TextFooterProps> | undefined

/** A downstream app (Panacode) replaces the reply footer; set through `setTimelineOverrides({ TextFooter })`. */
export function setTextFooterOverride(component: Component<TextFooterProps> | undefined) {
  footer = component
}

export function textFooterOverride() {
  return footer
}
