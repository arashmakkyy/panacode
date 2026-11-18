/** The New timeline, as the app sees it: its rows, how they draw, and the status line below a working turn. */
export { createNextTimelineProjection } from "./projection"

export { createNextTimelineRowRenderer } from "./row"

export { laneGap } from "./spacing"

export { timelineStatus } from "./status"

export { StatusLane } from "./status-line"

export { setTimelineOverrides, toolTurn, type TimelineOverrides, type ContextGroupProps, type FileGroupProps, type ThoughtRowProps } from "./overrides"

export { ContextGroup, type ActivityGroupPart } from "./tools/context-group"

export { FileGroup } from "./tools/file-group"

export { ThoughtRow } from "./tools/thought"
