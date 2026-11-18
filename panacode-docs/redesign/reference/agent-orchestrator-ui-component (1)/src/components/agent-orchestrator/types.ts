import type { ReactNode } from "react";

export interface OrchestratorSubtask {
  id: string;
  title: string;
  instruction?: string;
  workerId?: string;
}

export interface OrchestratorWorker {
  id: string;
  name: string;
  mark?: ReactNode;
}

export interface OrchestratorLead {
  name: string;
  mark?: ReactNode;
}

export type OrchestratorEvent =
  | { type: "plan"; subtask: OrchestratorSubtask }
  | { type: "dispatch"; subtaskId: string }
  | { type: "tool"; subtaskId: string; tool: string; target?: string }
  | { type: "toolResult"; subtaskId: string; summary?: string }
  | { type: "output"; subtaskId: string; delta: string; newLine?: boolean }
  | { type: "usage"; subtaskId?: string; tokens: number; cost: number }
  | { type: "error"; subtaskId: string; message: string; retryInMs?: number }
  | { type: "retry"; subtaskId: string }
  | { type: "result"; subtaskId: string; text: string }
  | { type: "fail"; subtaskId: string; message?: string }
  | { type: "summary"; delta: string }
  | { type: "done" };

export interface OrchestratorRunContext {
  goal: string;
  plan: OrchestratorSubtask[];
  workers: OrchestratorWorker[];
  /** Live concurrency limit. Read it before each dispatch. */
  concurrency: () => number;
  signal: AbortSignal;
}

export type OrchestratorRun = (context: OrchestratorRunContext) => AsyncIterable<OrchestratorEvent>;

export type LaneStatus =
  | "waiting"
  | "planned"
  | "queued"
  | "starting"
  | "running"
  | "failed"
  | "returned"
  | "gaveup"
  | "stopped";

export interface OrchestratorLaneResult {
  subtask: OrchestratorSubtask | null;
  worker: OrchestratorWorker;
  status: LaneStatus;
  text: string;
  tokens: number;
  cost: number;
  ms: number;
}

export interface OrchestratorResult {
  summary: string;
  tokens: number;
  cost: number;
  wallMs: number;
  sequentialMs: number;
  speedup: number;
  lanes: OrchestratorLaneResult[];
}

export interface AgentOrchestratorProps {
  goal?: string;
  plan?: OrchestratorSubtask[];
  workers?: OrchestratorWorker[];
  lead?: OrchestratorLead;
  run?: OrchestratorRun;
  concurrency?: number;
  defaultConcurrency?: number;
  onConcurrencyChange?: (value: number) => void;
  autoStart?: boolean;
  onComplete?: (result: OrchestratorResult) => void;
  className?: string;
}
