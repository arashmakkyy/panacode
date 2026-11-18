import type { Component } from "solid-js"
import { setTextFooterOverride, type TextFooterProps } from "../message/footer-override"
import type { ContextGroup } from "./tools/context-group"
import type { FileGroup } from "./tools/file-group"
import type { ThoughtRow } from "./tools/thought"

export type ContextGroupProps = Parameters<typeof ContextGroup>[0]
export type FileGroupProps = Parameters<typeof FileGroup>[0]
export type ThoughtRowProps = Parameters<typeof ThoughtRow>[0]


/**
 * Presentation overrides for timeline rows. A downstream app (Panacode) registers replacement components
 * that take the same props; unset entries render the built in component.
 */
export type TimelineOverrides = {
  ContextGroup?: Component<ContextGroupProps>
  FileGroup?: Component<FileGroupProps>
  ThoughtRow?: Component<ThoughtRowProps>
  TextFooter?: Component<TextFooterProps>
}

let overrides: TimelineOverrides = {}

export type { TextFooterProps }

export function setTimelineOverrides(next: TimelineOverrides) {
  overrides = { ...overrides, ...next }
  if ("TextFooter" in next) setTextFooterOverride(next.TextFooter)
}

export function timelineOverride<K extends keyof TimelineOverrides>(key: K): TimelineOverrides[K] {
  return overrides[key]
}

// The user message that opened the turn a tool part belongs to (for a downstream "undo this turn").
const toolTurns = new WeakMap<object, string>()

export function setToolTurn(tool: object, userMessageID: string) {
  toolTurns.set(tool, userMessageID)
}

export function toolTurn(tool: object) {
  return toolTurns.get(tool)
}
