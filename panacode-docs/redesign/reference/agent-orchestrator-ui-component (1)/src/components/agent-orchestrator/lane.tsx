import { memo, type CSSProperties, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "../../utils/cn";
import { Countdown, Counter, Elapsed, StreamLine, Swap } from "./primitives";
import { ChevronIcon, KnotMark, LeafMark, SparkMark, StarMark, StatusGlyph, ToolIcon, toolLabel } from "./icons";
import type { LaneView, LogEntry } from "./state";
import type { LaneStatus, OrchestratorWorker } from "./types";

export function defaultMark(worker: OrchestratorWorker, size = 14): ReactNode {
  if (worker.mark) return worker.mark;
  const n = worker.name.toLowerCase();
  if (n.includes("claude")) return <SparkMark size={size} />;
  if (n.includes("gemini")) return <StarMark size={size} />;
  if (n.includes("gpt")) return <KnotMark size={size} />;
  return <LeafMark size={size} />;
}

const STATUS_TONE: Record<LaneStatus, string> = {
  waiting: "text-fg3",
  planned: "text-fg3",
  queued: "text-fg3",
  starting: "text-[var(--c)]",
  running: "text-[var(--c)]",
  failed: "text-danger",
  returned: "text-ok",
  gaveup: "text-danger",
  stopped: "text-fg3",
};

const LIVE: LaneStatus[] = ["starting", "running"];

export function statusWord(v: LaneView): string {
  const { lane, status, place } = v;
  switch (status) {
    case "waiting":
      return "Waiting";
    case "planned":
      return "Planned";
    case "queued":
      return `Queued, place ${place}`;
    case "starting":
      return "Starting";
    case "running":
      return lane.tool ? toolLabel(lane.tool.name) : "Thinking";
    case "failed":
      return lane.retryAt ? "Failed, retrying" : "Failed";
    case "returned":
      return "Returned";
    case "gaveup":
      return "Gave up";
    case "stopped":
      return "Stopped";
  }
}

function StatusChip({ v, reduced }: { v: LaneView; reduced: boolean }) {
  const { lane, status, place } = v;
  const live = LIVE.includes(status);
  const key = status + (status === "running" ? `:${lane.tool?.name ?? "think"}` : "");
  let label: ReactNode;
  switch (status) {
    case "queued":
      label = (
        <>
          Queued <span className="tabular-nums opacity-80">· #{place}</span>
        </>
      );
      break;
    case "failed":
      label = (
        <>
          Failed
          {lane.retryAt ? (
            <>
              {" "}
              <span className="opacity-80">· retry in </span>
              <Countdown until={lane.retryAt} />
            </>
          ) : null}
        </>
      );
      break;
    default:
      label = statusWord(v);
  }
  return (
    <span className={cn("flex min-w-0 max-w-full items-center gap-1.5 text-xs font-medium", STATUS_TONE[status])}>
      <span className="grid size-3.5 shrink-0 place-items-center">
        <StatusGlyph status={status} spin={!reduced} />
      </span>
      <Swap id={key} className="min-w-0 flex-1">
        <span className={cn("block truncate", live && "arc-shimmer")} style={live ? ({ "--sh-base": "var(--c)", "--sh-hi": "var(--fg)" } as CSSProperties) : undefined}>
          {label}
        </span>
      </Swap>
    </span>
  );
}

function DetailLine({ v }: { v: LaneView }) {
  const { lane, status } = v;
  let key: string;
  let node: ReactNode;
  if ((status === "running" || status === "failed") && lane.tool && status === "running") {
    key = `tool:${lane.tool.name}:${lane.tool.target}`;
    node = (
      <span className="flex min-w-0 items-center gap-1.5 text-fg2">
        <span className="shrink-0 text-[var(--c)]">
          <ToolIcon tool={lane.tool.name} />
        </span>
        <span className="truncate font-mono text-[12px]">{lane.tool.target || toolLabel(lane.tool.name)}</span>
      </span>
    );
  } else if (status === "failed" || status === "gaveup") {
    key = `err:${lane.error}`;
    node = (
      <span className="flex min-w-0 items-center gap-1.5 text-danger">
        <span className="truncate text-[12px]">{lane.error}</span>
      </span>
    );
  } else if (status === "running") {
    key = "thinking";
    node = <span className="truncate text-[12px] text-fg3">Reading what came back</span>;
  } else if (status === "returned" || status === "stopped") {
    key = `done:${lane.toolCount}`;
    node = (
      <span className="truncate text-[12px] text-fg3">
        {lane.toolCount} tool {lane.toolCount === 1 ? "call" : "calls"}
        {lane.attempts > 1 ? ` · ${lane.attempts - 1} retry` : ""}
      </span>
    );
  } else if (status === "starting") {
    key = "starting";
    node = <span className="truncate text-[12px] text-fg3">Packet landing, opening a session</span>;
  } else {
    key = `plan:${lane.subtask?.id ?? "none"}`;
    node = (
      <span className="truncate text-[12px] text-fg3">
        {lane.subtask ? (lane.subtask.instruction ?? "Ready to run") : "Waiting for the lead's plan"}
      </span>
    );
  }
  return (
    <Swap id={key} className="h-5">
      <span className="flex h-5 items-center">{node}</span>
    </Swap>
  );
}

const KIND_LABEL: Record<LogEntry["kind"], string> = {
  plan: "plan",
  dispatch: "sent",
  tool: "tool",
  toolResult: "got",
  output: "said",
  error: "error",
  retry: "retry",
  result: "done",
  fail: "gave up",
};

function Transcript({ lane }: { lane: LaneView["lane"] }) {
  const entries = lane.log.slice(-14);
  return (
    <ol className="space-y-1 border-t border-line bg-sunken px-3.5 py-3 font-mono text-[11.5px] leading-[1.45]">
      {entries.length === 0 && <li className="text-fg3">Nothing yet.</li>}
      {entries.map((e, i) => (
        <li key={`${lane.log.length - entries.length + i}`} className="flex gap-2.5">
          <span className="w-9 shrink-0 text-right tabular-nums text-fg3">{(e.at / 1000).toFixed(1)}s</span>
          <span
            className={cn(
              "w-11 shrink-0",
              e.kind === "error" || e.kind === "fail" ? "text-danger" : e.kind === "result" ? "text-ok" : e.kind === "tool" ? "text-[var(--c)]" : "text-fg3",
            )}
          >
            {KIND_LABEL[e.kind]}
          </span>
          <span className={cn("min-w-0 flex-1 break-words", e.kind === "output" || e.kind === "result" ? "text-fg" : "text-fg2")}>
            {e.kind === "tool" ? (
              <>
                <span className="text-fg">{e.tool}</span> {e.text}
              </>
            ) : (
              e.text
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

interface LaneCardProps {
  view: LaneView;
  colorIndex: number;
  open: boolean;
  onToggle: (index: number) => void;
  idPrefix: string;
  reduced: boolean;
  registerRef: (index: number, el: HTMLDivElement | null) => void;
}

function LaneCardImpl({ view, colorIndex, open, onToggle, idPrefix, reduced, registerRef }: LaneCardProps) {
  const { lane, status, progress } = view;
  const live = LIVE.includes(status);
  const settled = status === "returned" || status === "gaveup" || status === "stopped";
  const panelId = `${idPrefix}-lane-${lane.index}-log`;
  const title = lane.subtask?.title ?? "Waiting for a subtask";
  const active = ["starting", "running", "failed", "returned"].includes(status);
  const barColor = status === "failed" || status === "gaveup" ? "var(--danger)" : "var(--c)";

  return (
    <div
      ref={el => registerRef(lane.index, el)}
      className="@container/lane flex min-w-0 flex-col"
      style={{ "--c": `var(--s${(colorIndex % 4) + 1})` } as CSSProperties}
    >
      <div
        className={cn(
          "relative flex flex-1 flex-col overflow-hidden rounded-2xl border bg-card transition-[border-color,box-shadow,opacity] duration-300",
          status === "waiting" && "border-dashed opacity-70",
        )}
        style={{
          borderColor: active
            ? status === "failed"
              ? "color-mix(in oklab, var(--danger) 45%, var(--line))"
              : "color-mix(in oklab, var(--c) 38%, var(--line))"
            : "var(--line)",
          boxShadow: live ? "0 10px 30px -16px color-mix(in oklab, var(--c) 55%, transparent)" : "var(--shadow)",
        }}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${title}, ${lane.worker.name}, ${statusWord(view)}`}
          onClick={() => onToggle(lane.index)}
          className="group relative block w-full min-w-0 rounded-2xl px-3.5 pb-3 pt-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
        >
          {/* progress */}
          <span aria-hidden className="absolute inset-x-0 top-0 block h-0.5 overflow-hidden bg-transparent">
            <span
              className="relative block h-full origin-left overflow-hidden"
              style={{
                background: barColor,
                transform: `scaleX(${progress})`,
                transition: reduced ? "none" : "transform 700ms cubic-bezier(0.2, 0.7, 0.2, 1), background-color 200ms",
              }}
            >
              {live && !reduced && (
                <span className="arc-sweep absolute inset-y-0 left-0 block w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent" />
              )}
            </span>
          </span>

          <span className="flex items-center justify-between gap-2 @max-[230px]/lane:flex-col @max-[230px]/lane:items-start">
            <span className="flex min-w-0 max-w-full items-center gap-2">
              <span
                aria-hidden
                className="grid size-6 shrink-0 place-items-center rounded-md bg-[color-mix(in_oklab,var(--c)_14%,transparent)] text-[var(--c)]"
              >
                {defaultMark(lane.worker, 14)}
              </span>
              <span className="truncate text-xs font-medium text-fg2">{lane.worker.name}</span>
            </span>
            <span className="min-w-0 max-w-full shrink-[2]">
              <StatusChip v={view} reduced={reduced} />
            </span>
          </span>

          <span className="mt-2.5 block">
            <Swap id={lane.subtask?.id ?? "none"}>
              <span className={cn("block truncate text-[14px] font-semibold leading-5 tracking-[-0.005em]", lane.subtask ? "text-fg" : "text-fg3")}>
                {title}
              </span>
            </Swap>
          </span>

          <span className="mt-1 block">
            <DetailLine v={view} />
          </span>

          <span
            className={cn(
              "mt-2.5 block h-7 overflow-hidden rounded-md bg-sunken px-2 text-[12px] leading-7 ring-1 ring-inset ring-line",
              settled && status === "returned" ? "text-fg" : "text-fg2",
            )}
          >
            <StreamLine
              text={status === "returned" ? (lane.result ?? lane.line) : lane.line}
              streaming={live && status === "running"}
              placeholder={status === "waiting" ? "" : "No output yet"}
              className="leading-7"
            />
          </span>

          <span className="mt-2.5 flex items-center justify-between gap-2 text-[11.5px] text-fg3">
            <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
              <span className="text-fg2">
                <Counter value={lane.tokens} />
              </span>
              <span>tok</span>
              <span aria-hidden className="opacity-50">
                ·
              </span>
              <span className="text-fg2">
                <Counter value={lane.cost} format="cost" />
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <Elapsed start={lane.startedAt} end={lane.endedAt} className="text-fg2" />
              <span
                className="grid size-4 place-items-center transition-transform duration-300 group-hover:text-fg2"
                style={{ transform: open ? "rotate(180deg)" : undefined }}
              >
                <ChevronIcon />
              </span>
            </span>
          </span>
        </button>

        <motion.div
          id={panelId}
          role="region"
          aria-label={`${title} transcript`}
          inert={!open}
          aria-hidden={!open}
          initial={false}
          animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
          transition={reduced ? { duration: 0 } : { type: "spring", duration: 0.42, bounce: 0 }}
          className="overflow-hidden"
        >
          <Transcript lane={lane} />
        </motion.div>
      </div>
    </div>
  );
}

export const LaneCard = memo(LaneCardImpl, (a, b) => {
  const x = a.view;
  const y = b.view;
  return (
    x.lane === y.lane &&
    x.status === y.status &&
    x.place === y.place &&
    x.progress === y.progress &&
    a.open === b.open &&
    a.reduced === b.reduced &&
    a.colorIndex === b.colorIndex &&
    a.idPrefix === b.idPrefix &&
    a.onToggle === b.onToggle &&
    a.registerRef === b.registerRef
  );
});
