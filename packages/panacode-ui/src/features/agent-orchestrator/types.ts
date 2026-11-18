import type { JSX } from "solid-js"

export type LaneStatus = "planned" | "starting" | "running" | "returned" | "gaveup" | "stopped"

export type LaneLogKind = "dispatch" | "tool" | "toolResult" | "output" | "error" | "result"

export interface LaneLogEntry {
  /** ms since the lane started */
  at: number
  kind: LaneLogKind
  tool?: string
  text: string
}

export interface OrchestratorLaneView {
  id: string
  title: string
  instruction?: string
  worker: { name: string; mark?: JSX.Element }
  status: LaneStatus
  /** The tool the worker is in right now. */
  tool?: { name: string; label: string; target?: string }
  /** The worker's latest line of output. */
  line: string
  /** The worker's final answer once returned. */
  result?: string
  error?: string
  toolCount: number
  tokens: number
  cost: number
  startedAt?: number
  endedAt?: number
  log: LaneLogEntry[]
  /** 0 to 1, how far the lane is. */
  progress: number
}

export type OrchestratorPhase = "planning" | "running" | "summarizing" | "done" | "stopped"

export interface OrchestratorView {
  goal: string
  /** The mark renders twice (lead and summary), so it is a factory. */
  lead: { name: string; mark?: () => JSX.Element }
  phase: OrchestratorPhase
  startedAt: number
  endedAt?: number
  lanes: OrchestratorLaneView[]
  summary: string
}

export interface OrchestratorLabels {
  eyebrow: string
  lead: string
  plan: string
  planning: string
  dispatching: string
  returned: (done: number, total: number) => string
  summarizing: string
  done: string
  stopped: string
  stop: string
  dismiss: string
  summary: string
  summaryWaiting: string
  summaryStopped: string
  copy: string
  copied: string
  status: Record<LaneStatus, string>
  thinking: string
  starting: string
  toolCalls: (count: number) => string
  noOutput: string
  nothingYet: string
  transcript: (title: string) => string
  log: Record<LaneLogKind, string>
  tokens: string
  tok: string
  cost: string
  wallTime: string
  speedup: string
  inParallel: string
  inSequence: string
  compare: string
  parallelLanes: (count: number) => string
}

export const defaultOrchestratorLabels: OrchestratorLabels = {
  eyebrow: "Orchestrator",
  lead: "Lead",
  plan: "Plan",
  planning: "Planning",
  dispatching: "Dispatching",
  returned: (done, total) => `${done} of ${total} returned`,
  summarizing: "Writing the summary",
  done: "Done",
  stopped: "Stopped",
  stop: "Stop",
  dismiss: "Close",
  summary: "Summary",
  summaryWaiting: "Waiting for every lane to return, then the lead merges what came back.",
  summaryStopped: "The run was stopped before the lanes returned.",
  copy: "Copy",
  copied: "Copied",
  status: {
    planned: "Planned",
    starting: "Starting",
    running: "Working",
    returned: "Returned",
    gaveup: "Gave up",
    stopped: "Stopped",
  },
  thinking: "Thinking",
  starting: "Opening a session",
  toolCalls: (count) => (count === 1 ? "1 tool call" : `${count} tool calls`),
  noOutput: "No output yet",
  nothingYet: "Nothing yet.",
  transcript: (title) => `${title} transcript`,
  log: { dispatch: "sent", tool: "tool", toolResult: "got", output: "said", error: "error", result: "done" },
  tokens: "Tokens",
  tok: "tok",
  cost: "Cost",
  wallTime: "Wall time",
  speedup: "Speedup",
  inParallel: "In parallel",
  inSequence: "In sequence",
  compare: "Wall time compared with running every subtask in sequence",
  parallelLanes: (count) => `${count} parallel lanes`,
}
