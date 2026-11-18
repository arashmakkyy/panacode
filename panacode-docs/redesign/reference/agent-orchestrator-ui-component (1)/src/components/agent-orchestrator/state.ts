import type {
  LaneStatus,
  OrchestratorEvent,
  OrchestratorLaneResult,
  OrchestratorResult,
  OrchestratorSubtask,
  OrchestratorWorker,
} from "./types";

export type Phase = "idle" | "planning" | "running" | "summarizing" | "done" | "stopped" | "error";

export interface LogEntry {
  kind: "plan" | "dispatch" | "tool" | "toolResult" | "output" | "error" | "retry" | "result" | "fail";
  text: string;
  /** ms since the lane was dispatched (0 for plan) */
  at: number;
  tool?: string;
}

export interface Lane {
  index: number;
  worker: OrchestratorWorker;
  subtask: OrchestratorSubtask | null;
  status: Exclude<LaneStatus, "queued">;
  tool: { name: string; target?: string } | null;
  toolCount: number;
  line: string;
  error?: string;
  retryAt?: number;
  attempts: number;
  tokens: number;
  cost: number;
  startedAt?: number;
  endedAt?: number;
  result?: string;
  log: LogEntry[];
}

export interface State {
  phase: Phase;
  lanes: Lane[];
  plan: { subtask: OrchestratorSubtask; lane: number }[];
  summary: string[];
  leadTokens: number;
  leadCost: number;
  startedAt?: number;
  firstDispatchAt?: number;
  lastReturnAt?: number;
  endedAt?: number;
  error?: string;
}

const MAX_LOG = 120;

export function makeLanes(workers: OrchestratorWorker[]): Lane[] {
  return workers.map((worker, index) => ({
    index,
    worker,
    subtask: null,
    status: "waiting",
    tool: null,
    toolCount: 0,
    line: "",
    attempts: 0,
    tokens: 0,
    cost: 0,
    log: [],
  }));
}

export function initialState(workers: OrchestratorWorker[]): State {
  return { phase: "idle", lanes: makeLanes(workers), plan: [], summary: [], leadTokens: 0, leadCost: 0 };
}

export function laneIndexFor(state: State, subtaskId: string) {
  return state.lanes.findIndex(l => l.subtask?.id === subtaskId);
}

function pushLog(lane: Lane, entry: LogEntry): Lane {
  const log = lane.log.length >= MAX_LOG ? lane.log.slice(lane.log.length - MAX_LOG + 1) : lane.log.slice();
  log.push(entry);
  return { ...lane, log };
}

const rel = (lane: Lane, now: number) => (lane.startedAt === undefined ? 0 : Math.max(0, now - lane.startedAt));

export type Action =
  | { kind: "start"; now: number; workers: OrchestratorWorker[] }
  | { kind: "event"; event: OrchestratorEvent; now: number; workers: OrchestratorWorker[] }
  | { kind: "stop"; now: number }
  | { kind: "crash"; now: number; message: string };

export function reduce(state: State, action: Action): State {
  switch (action.kind) {
    case "start":
      return { ...initialState(action.workers), phase: "planning", startedAt: action.now };

    case "stop": {
      if (state.phase === "done" || state.phase === "stopped" || state.phase === "idle") return state;
      return {
        ...state,
        phase: "stopped",
        endedAt: action.now,
        lanes: state.lanes.map(l =>
          l.subtask && ["planned", "starting", "running", "failed"].includes(l.status)
            ? { ...l, status: "stopped" as const, endedAt: l.startedAt === undefined ? undefined : action.now, retryAt: undefined, tool: null }
            : l,
        ),
      };
    }

    case "crash":
      return {
        ...state,
        phase: "error",
        error: action.message,
        endedAt: action.now,
        lanes: state.lanes.map(l =>
          l.subtask && ["starting", "running", "failed"].includes(l.status)
            ? { ...l, status: "gaveup" as const, error: action.message, endedAt: action.now, retryAt: undefined, tool: null }
            : l,
        ),
      };

    case "event":
      return reduceEvent(state, action.event, action.now, action.workers);
  }
}

function patchLane(state: State, subtaskId: string, fn: (lane: Lane) => Lane): State {
  const i = laneIndexFor(state, subtaskId);
  if (i < 0) return state;
  const lanes = state.lanes.slice();
  lanes[i] = fn(lanes[i]);
  return { ...state, lanes };
}

function reduceEvent(state: State, e: OrchestratorEvent, now: number, workers: OrchestratorWorker[]): State {
  switch (e.type) {
    case "plan": {
      if (laneIndexFor(state, e.subtask.id) >= 0) return state;
      let lanes = state.lanes.slice();
      let idx = -1;
      if (e.subtask.workerId) idx = lanes.findIndex(l => !l.subtask && l.worker.id === e.subtask.workerId);
      if (idx < 0) idx = lanes.findIndex(l => !l.subtask);
      if (idx < 0) {
        // more subtasks than workers: add a lane that reuses a worker
        const worker =
          (e.subtask.workerId && workers.find(w => w.id === e.subtask.workerId)) || workers[lanes.length % Math.max(1, workers.length)];
        lanes = [...lanes, ...makeLanes([worker]).map(l => ({ ...l, index: lanes.length }))];
        idx = lanes.length - 1;
      }
      lanes[idx] = pushLog(
        { ...lanes[idx], subtask: e.subtask, status: "planned" },
        { kind: "plan", text: e.subtask.instruction ?? e.subtask.title, at: 0 },
      );
      return { ...state, phase: state.phase === "idle" ? "planning" : state.phase, lanes, plan: [...state.plan, { subtask: e.subtask, lane: idx }] };
    }

    case "dispatch": {
      const next = patchLane(state, e.subtaskId, l =>
        pushLog(
          { ...l, status: "starting", startedAt: now, endedAt: undefined, attempts: 1, error: undefined },
          { kind: "dispatch", text: `Dispatched to ${l.worker.name}`, at: 0 },
        ),
      );
      if (next === state) return state;
      return {
        ...next,
        phase: next.phase === "planning" || next.phase === "idle" ? "running" : next.phase,
        firstDispatchAt: state.firstDispatchAt ?? now,
      };
    }

    case "tool":
      return patchLane(state, e.subtaskId, l =>
        pushLog(
          { ...l, status: "running", tool: { name: e.tool, target: e.target }, toolCount: l.toolCount + 1, error: undefined, retryAt: undefined },
          { kind: "tool", text: e.target ?? "", tool: e.tool, at: rel(l, now) },
        ),
      );

    case "toolResult":
      return patchLane(state, e.subtaskId, l => {
        const next: Lane = { ...l, tool: null };
        return e.summary ? pushLog(next, { kind: "toolResult", text: e.summary, at: rel(l, now) }) : next;
      });

    case "output":
      return patchLane(state, e.subtaskId, l => {
        const line = e.newLine ? e.delta : l.line + e.delta;
        const last = l.log[l.log.length - 1];
        let log = l.log;
        if (!e.newLine && last && last.kind === "output") {
          log = l.log.slice(0, -1);
          log.push({ ...last, text: last.text + e.delta });
        } else {
          log = [...l.log, { kind: "output", text: e.delta, at: rel(l, now) }];
          if (log.length > MAX_LOG) log = log.slice(log.length - MAX_LOG);
        }
        return { ...l, line, log, status: l.status === "starting" ? "running" : l.status };
      });

    case "usage": {
      if (!e.subtaskId) return { ...state, leadTokens: state.leadTokens + e.tokens, leadCost: state.leadCost + e.cost };
      return patchLane(state, e.subtaskId, l => ({ ...l, tokens: l.tokens + e.tokens, cost: l.cost + e.cost }));
    }

    case "error":
      return patchLane(state, e.subtaskId, l =>
        pushLog(
          { ...l, status: "failed", error: e.message, retryAt: e.retryInMs ? now + e.retryInMs : undefined },
          { kind: "error", text: e.message, at: rel(l, now) },
        ),
      );

    case "retry":
      return patchLane(state, e.subtaskId, l =>
        pushLog(
          { ...l, status: "running", error: undefined, retryAt: undefined, attempts: l.attempts + 1 },
          { kind: "retry", text: `Retry ${l.attempts}`, at: rel(l, now) },
        ),
      );

    case "result": {
      const i = laneIndexFor(state, e.subtaskId);
      if (i < 0) return state;
      const next = patchLane(state, e.subtaskId, l =>
        pushLog(
          { ...l, status: "returned", result: e.text, tool: null, error: undefined, retryAt: undefined, endedAt: now },
          { kind: "result", text: e.text, at: rel(l, now) },
        ),
      );
      return { ...next, lastReturnAt: now };
    }

    case "fail": {
      const i = laneIndexFor(state, e.subtaskId);
      if (i < 0) return state;
      const next = patchLane(state, e.subtaskId, l =>
        pushLog(
          { ...l, status: "gaveup", error: e.message ?? l.error ?? "Gave up", tool: null, retryAt: undefined, endedAt: now },
          { kind: "fail", text: e.message ?? "Gave up", at: rel(l, now) },
        ),
      );
      return { ...next, lastReturnAt: now };
    }

    case "summary":
      if (!e.delta) return state;
      return { ...state, phase: "summarizing", summary: [...state.summary, e.delta] };

    case "done":
      if (state.phase === "done") return state;
      return { ...state, phase: "done", endedAt: now };
  }
}

/* ───────── Selectors ───────── */

const ACTIVE: Lane["status"][] = ["starting", "running", "failed"];

export function activeCount(lanes: Lane[]) {
  return lanes.reduce((n, l) => n + (ACTIVE.includes(l.status) ? 1 : 0), 0);
}

export interface LaneView {
  lane: Lane;
  status: LaneStatus;
  /** 1-based place in line when queued */
  place?: number;
  progress: number;
}

export function laneViews(state: State, concurrency: number): LaneView[] {
  const slotsFull = activeCount(state.lanes) >= concurrency;
  const waitingOrder = state.plan.filter(p => state.lanes[p.lane].status === "planned").map(p => p.lane);
  const live = state.phase === "running" || state.phase === "summarizing";
  return state.lanes.map(lane => {
    let status: LaneStatus = lane.status;
    let place: number | undefined;
    if (lane.status === "planned" && live && slotsFull) {
      status = "queued";
      place = waitingOrder.indexOf(lane.index) + 1;
    }
    const progress =
      lane.status === "returned" || lane.status === "gaveup"
        ? 1
        : lane.status === "planned" || lane.status === "waiting"
          ? 0
          : Math.min(0.93, 0.08 + (1 - Math.pow(0.62, lane.toolCount)) * 0.9);
    return { lane, status, place, progress };
  });
}

export function totals(state: State) {
  const tokens = state.lanes.reduce((n, l) => n + l.tokens, state.leadTokens);
  const cost = state.lanes.reduce((n, l) => n + l.cost, state.leadCost);
  const end = state.endedAt ?? state.lastReturnAt ?? 0;
  const wallMs = Math.max(1, (state.startedAt === undefined ? 0 : end - state.startedAt));
  const laneMs = state.lanes.reduce(
    (n, l) => (l.startedAt !== undefined && l.endedAt !== undefined ? n + (l.endedAt - l.startedAt) : n),
    0,
  );
  const stretch =
    state.firstDispatchAt !== undefined && state.lastReturnAt !== undefined ? Math.max(0, state.lastReturnAt - state.firstDispatchAt) : 0;
  const sequentialMs = Math.max(wallMs, wallMs - stretch + laneMs);
  return { tokens, cost, wallMs, sequentialMs, speedup: sequentialMs / wallMs };
}

export function buildResult(state: State): OrchestratorResult {
  const t = totals(state);
  const lanes: OrchestratorLaneResult[] = state.lanes.map(l => ({
    subtask: l.subtask,
    worker: l.worker,
    status: l.status,
    text: l.result ?? "",
    tokens: l.tokens,
    cost: l.cost,
    ms: l.startedAt !== undefined && l.endedAt !== undefined ? l.endedAt - l.startedAt : 0,
  }));
  return { summary: state.summary.join(""), ...t, lanes };
}
