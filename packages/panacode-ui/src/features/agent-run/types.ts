export type StepMark = "think" | "read" | "search" | "edit" | "terminal" | "review" | "web" | "task" | "tool"

export interface DiffLine {
  type: "add" | "del" | "ctx"
  old?: number
  new?: number
  text: string
}

export interface ChangedFile {
  path: string
  additions: number
  deletions: number
}

export interface RunCheck {
  label: string
  passed: boolean
}

export interface RunResult {
  summary: string
  files: ChangedFile[]
  /** Commands the run executed and how they exited (no tests are invented; only real exits). */
  checks: RunCheck[]
}

export interface ProposedChange {
  id: string
  summary: string
  files: { path: string; status: "added" | "modified" | "deleted"; lines: DiffLine[] }[]
}

export interface AgentStep {
  id: string
  mark: StepMark
  /** Present-tense verb while running ("Reading"), and past tense when done ("Read"). */
  verb: string
  doneVerb: string
  target?: string
  status: "running" | "waiting" | "done" | "rejected" | "failed"
  /** When the step started (ms epoch); a running step ticks from here. */
  startedAt?: number
  durationMs?: number
  io?: { input: string; output: string }
  text?: string
  change?: ProposedChange
  /** The note sent back with a rejection. */
  reason?: string
}

export interface AgentRunState {
  status: "working" | "waiting" | "done" | "stopped" | "failed"
  startedAt: number
  endedAt?: number
  steps: AgentStep[]
  error?: string
  result?: RunResult
  /** Files this run changed, for the folded result (also when stopped). */
  files?: ChangedFile[]
}

export interface AgentRunLabels {
  steps: string
  working: string
  waiting: string
  done: string
  stopped: string
  review: string
  stop: string
  dismiss: string
  secondsOfWork: (seconds: number) => string
  stepsFolded: (count: number, seconds: number) => string
  filesChanged: (count: number) => string
  added: (count: number) => string
  removed: (count: number) => string
  changedFiles: string
  nothingWritten: string
  approve: string
  reject: string
  whatShouldChange: string
  rejectPlaceholder: string
  cancel: string
  sendBack: string
  yourFeedback: string
  stoppedTitle: string
  stoppedBody: string
  failed: string
  approvedChanges: (path: string) => string
  waitingFirst: string
}

export const defaultAgentRunLabels: AgentRunLabels = {
  steps: "Steps",
  working: "Working",
  waiting: "Waiting for you",
  done: "Done",
  stopped: "Stopped",
  review: "Review",
  stop: "Stop run",
  dismiss: "Dismiss",
  secondsOfWork: (seconds) => `${seconds} seconds of work`,
  stepsFolded: (count, seconds) => `${count} steps · ${seconds}s`,
  filesChanged: (count) => (count === 1 ? "1 file changed" : `${count} files changed`),
  added: (count) => `${count} added`,
  removed: (count) => `${count} removed`,
  changedFiles: "Changed files",
  nothingWritten: "Nothing is written until you approve.",
  approve: "Approve",
  reject: "Reject",
  whatShouldChange: "What should change?",
  rejectPlaceholder: "For example, keep the old name",
  cancel: "Cancel",
  sendBack: "Send back",
  yourFeedback: "Your feedback",
  stoppedTitle: "Run stopped",
  stoppedBody: "The run was stopped. Changes it already wrote stay on disk.",
  failed: "Failed",
  approvedChanges: (path) => `Changes to ${path}`,
  waitingFirst: "Waiting for the first agent event…",
}
