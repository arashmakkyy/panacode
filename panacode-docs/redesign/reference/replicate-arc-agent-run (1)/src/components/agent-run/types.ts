import type { ReactNode } from 'react';

export type StepMark = 'think' | 'read' | 'search' | 'edit' | 'terminal' | 'review' | 'npm' | 'typescript' | 'github';

export interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  old?: number;
  new?: number;
  text: string;
}

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface RunResult {
  summary: string;
  files: ChangedFile[];
  tests: { passed: number; total: number };
  checks: { label: string; passed: boolean }[];
}

export interface ProposedChange {
  id: string;
  summary: string;
  files: {
    path: string;
    status: 'added' | 'modified' | 'deleted';
    lines: DiffLine[];
  }[];
  outcome?: RunResult;
}

export interface AgentStep {
  id: string;
  mark: StepMark;
  icon?: ReactNode;
  verb: string;
  doneVerb: string;
  target?: string;
  doneTarget?: string;
  status: 'running' | 'waiting' | 'done' | 'rejected';
  durationMs?: number;
  elapsedMs?: number;
  progress?: { value: number; total: number };
  io?: { input: string; output: string };
  text?: string;
  change?: ProposedChange;
  reason?: string;
}

export interface AgentRunState {
  status: 'working' | 'waiting' | 'done';
  elapsedMs: number;
  steps: AgentStep[];
  result?: RunResult;
}

export interface ScriptStep extends Omit<AgentStep, 'status' | 'elapsedMs'> {
  durationMs: number;
  revise?: ScriptStep[];
}

export interface RunScript {
  steps: ScriptStep[];
  result: RunResult;
}

export interface PullRequest {
  number: number;
  url: string;
}

export interface AgentRunProps {
  task?: string;
  model?: { name: string; mark?: ReactNode };
  script?: RunScript;
  run?: AgentRunState;
  autoPlay?: boolean;
  onApprove?: (change: ProposedChange) => void;
  onReject?: (change: ProposedChange, reason: string) => void;
  onOpenPullRequest?: () => Promise<PullRequest | void> | PullRequest | void;
  onRestart?: () => void;
  className?: string;
}