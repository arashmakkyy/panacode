import type { Component } from "solid-js"
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
}

let overrides: TimelineOverrides = {}

export function setTimelineOverrides(next: TimelineOverrides) {
  overrides = { ...overrides, ...next }
}

export function timelineOverride<K extends keyof TimelineOverrides>(key: K): TimelineOverrides[K] {
  return overrides[key]
}
