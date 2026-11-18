"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { MutableRefObject, ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import type { AnimationPlaybackControls, Transition } from "motion/react";
import { Ban, Check, ChevronDown, ChevronRight, CircleAlert, Copy, Shield } from "lucide-react";
import { motionTokens } from "../lib/motion-tokens";
import { toolMarks } from "./tool-call-marks";
import type { ToolCallToolId } from "./tool-call-marks";
import styles from "./tool-call.module.css";

/* ---------------------------------------------------------------------------------------------- */
/* Types                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

export type ToolCallStatus = "running" | "success" | "error" | "approval" | "denied";

/** A built in tool id draws the real brand mark; a custom tool passes its own name and a 16px mark. */
export type ToolCallTool = ToolCallToolId | { name: string; mark: ReactNode };

export type ToolCallValue = string | number | boolean | null | ToolCallValue[] | { [key: string]: ToolCallValue };
export type ToolCallCell = string | number | boolean | null;

export interface ToolCallListItem {
  /** A number or id shown before the title, such as "#1284". Falls back to the row number. */
  lead?: string;
  title: string;
  tag?: string;
}

export type ToolCallOutput =
  | { type: "list"; items: ToolCallListItem[] }
  | { type: "table"; columns: string[]; rows: ToolCallCell[][] }
  | { type: "json"; value: ToolCallValue }
  | { type: "text"; text: string };

/** The shape of one call, shared by ToolCall props and ToolCallGroup calls. */
export interface ToolCallData {
  /** Stable id for the call. A group uses it as the React key, so a call that changes status keeps its row and its open state. */
  id: string;
  /** Which tool ran. */
  tool: ToolCallTool;
  /** The settled verb phrase, such as "Searched issues in arc-ui/web". Keep it to one line; it truncates. */
  title: string;
  /** Phrasing per status, such as { running: "Searching issues in arc-ui/web", approval: "Post a summary to #release" }. Falls back to title. */
  titles?: Partial<Record<ToolCallStatus, string>>;
  status: ToolCallStatus;
  /** The arguments the model passed, shown as a mono key and value list with a copy button. */
  input?: Record<string, ToolCallValue>;
  /** What came back. */
  output?: ToolCallOutput;
  /** Quiet meta before the duration, such as "4 results". Derived from the output when left out. */
  summary?: string;
  /** One line under the title: the error reason, or what allowing the call will do. */
  message?: string;
  /** How long the call took, shown as 640ms or 1.2s. */
  durationMs?: number;
}

export interface ToolCallProps extends Partial<ToolCallData> {
  /** Opens the Input and Output panel on first render. */
  defaultOpen?: boolean;
  /** Controls the panel. Pair with onOpenChange. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Allow on a call awaiting approval. Update status yourself (usually to running, then success). Without it the preview simulates the call. */
  onApprove?: () => void;
  /** Deny on a call awaiting approval. Without it the call is marked denied locally. */
  onDeny?: () => void;
  /** Retry on a failed call. Without it the preview simulates a successful retry. */
  onRetry?: () => void;
  /** Draws a custom result for a successful call inside the Output well. Return undefined to fall back to the built in view. */
  renderOutput?: (call: ToolCallData) => ReactNode | undefined;
  className?: string;
}

export interface ToolCallGroupProps {
  /** The calls in order. Append as the agent starts new calls; each new row grows in. */
  calls?: ToolCallData[];
  /** The agent is still working in this turn, so the header keeps saying "Using" between calls. Defaults to any call running. */
  active?: boolean;
  /** Whether the list is open on first render. Defaults to open while any call is running, waiting or failed. */
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Folds the list 450ms after every call has finished. Skipped once the person has opened or closed the group or any row. */
  autoCollapse?: boolean;
  onApprove?: (call: ToolCallData) => void;
  onDeny?: (call: ToolCallData) => void;
  onRetry?: (call: ToolCallData) => void;
  renderOutput?: (call: ToolCallData) => ReactNode | undefined;
  className?: string;
}

/* ---------------------------------------------------------------------------------------------- */
/* Helpers                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");
/** Motion wants a mutable bezier tuple; the tokens are readonly. */
const bezier = (ease: readonly [number, number, number, number]): [number, number, number, number] => [ease[0], ease[1], ease[2], ease[3]];

const FOLD_ROWS = 5;
const FOLD_LINES = 10;
const ROW_HEIGHT = 28;
const LINE_HEIGHT = 20;
const JSON_PADDING = 16;
const MARK_STEP = 14;
const MARK_SIZE = 20;

/** 640ms below a second, 1.2s below a minute, then 1m 12s. */
export function formatDuration(ms?: number): string | undefined {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) {
    const seconds = ms / 1000;
    return `${seconds < 10 ? seconds.toFixed(1).replace(/\.0$/, "") : Math.round(seconds)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

const plural = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`;

function deriveSummary(output?: ToolCallOutput): string | undefined {
  if (!output) return undefined;
  switch (output.type) {
    case "list": return plural(output.items.length, "result");
    case "table": return plural(output.rows.length, "row");
    case "json": {
      const value = output.value;
      if (Array.isArray(value)) return plural(value.length, "item");
      if (value && typeof value === "object") return plural(Object.keys(value).length, "field");
      return undefined;
    }
    case "text": return undefined;
  }
}

const toolName = (tool: ToolCallTool) => (typeof tool === "string" ? toolMarks[tool].name : tool.name);
const toolMark = (tool: ToolCallTool) => (typeof tool === "string" ? toolMarks[tool].mark : tool.mark);
const toolKey = (tool: ToolCallTool) => (typeof tool === "string" ? tool : `custom:${tool.name}`);

const cellText = (cell: ToolCallCell) => (cell === null ? "null" : String(cell));
const valueKind = (value: ToolCallValue) => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);
const valueText = (value: ToolCallValue) => (typeof value === "string" ? value : value !== null && typeof value === "object" ? JSON.stringify(value) : String(value));

function outputText(output: ToolCallOutput): string {
  switch (output.type) {
    case "list": return output.items.map((item, i) => [item.lead ?? `${i + 1}.`, item.title, item.tag ? `[${item.tag}]` : ""].filter(Boolean).join(" ")).join("\n");
    case "table": return [output.columns, ...output.rows.map(row => row.map(cellText))].map(row => row.join("\t")).join("\n");
    case "json": return JSON.stringify(output.value, null, 2);
    case "text": return output.text;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy path */ }
  try {
    // Legacy path. The helper textarea takes focus while it is selected, so focus goes back to the button afterwards.
    const active = document.activeElement as HTMLElement | null;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.setAttribute("aria-hidden", "true");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.opacity = "0";
    area.style.pointerEvents = "none";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    active?.focus?.({ preventScroll: true });
    return ok;
  } catch {
    return false;
  }
}

/** The status spelled out for the row name and the live region, such as "Done, 4 results, 1.2s". */
function statusSentence(status: ToolCallStatus, summary?: string, duration?: string, message?: string) {
  switch (status) {
    case "running": return "Running";
    case "success": return ["Done", summary, duration].filter(Boolean).join(", ");
    case "error": return message ? `Failed. ${message}` : "Failed";
    case "approval": return message ? `Waiting for approval. ${message}` : "Waiting for approval";
    case "denied": return "Denied, the call never ran";
  }
}

const emptyOutput: Record<ToolCallStatus, string> = {
  running: "Waiting for the result",
  success: "No output",
  error: "No output",
  approval: "Runs after it is allowed",
  denied: "Never ran",
};

/** Lets panels that animate their own height tell the row to follow without a second spring. */
const SelfMotionContext = createContext<MutableRefObject<number> | null>(null);
const SELF_MOTION_WINDOW = 700;

function useArmSelfMotion() {
  const ref = useContext(SelfMotionContext);
  return useCallback(() => { if (ref) ref.current = performance.now() + SELF_MOTION_WINDOW; }, [ref]);
}

/**
 * The row's height follows its content on the smooth spring through one ResizeObserver, so a reason line or wrapped actions never resize in one frame.
 * Width changes from the container, reduced motion and the row's own panel animations cut straight to the new height.
 */
function useFollowHeight(reduced: boolean) {
  const inner = useRef<HTMLDivElement>(null);
  const selfUntil = useRef(0);
  const height = useMotionValue<number | "auto">("auto");
  useEffect(() => {
    const node = inner.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let lastWidth = -1;
    let lastHeight = -1;
    let controls: AnimationPlaybackControls | undefined;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const width = entry.contentRect.width;
      const next = entry.contentRect.height;
      const cut = lastHeight < 0 || width !== lastWidth || reduced || performance.now() < selfUntil.current;
      controls?.stop();
      if (cut || Math.abs(next - lastHeight) < 0.5) height.jump(next);
      else controls = animate(height, next, motionTokens.spring.smooth);
      lastWidth = width;
      lastHeight = next;
    });
    observer.observe(node);
    return () => { observer.disconnect(); controls?.stop(); };
  }, [reduced, height]);
  return { inner, height, selfUntil };
}

/* ---------------------------------------------------------------------------------------------- */
/* Shimmer: the running title. The band is the text color over a muted base and settles to solid.  */
/* ---------------------------------------------------------------------------------------------- */

const band = 2.2;
const falloff = [[-1, 0], [-0.5, 0.5], [-0.2, 0.9], [0, 1], [0.2, 0.9], [0.5, 0.5], [1, 0]] as const;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const SWEEP = 1.8;

function shimmerImage(t: number, settle: number) {
  const base = `color-mix(in oklab, var(--ts-highlight) ${percent(settle)}, var(--ts-base))`;
  const stops = falloff.map(([offset, strength]) => `color-mix(in oklab, var(--ts-highlight) ${percent(strength)}, ${base}) calc(${(t * 100).toFixed(2)}% + ${((2 * t - 1 + offset) * band).toFixed(3)}em)`);
  return `linear-gradient(90deg, ${base}, ${stops.join(", ")}, ${base})`;
}

function Shimmer({ children, active, reduced }: { children: string; active: boolean; reduced: boolean }) {
  const sweep = useMotionValue(0);
  const settle = useMotionValue(active ? 0 : 1);
  const backgroundImage = useTransform(() => shimmerImage(sweep.get(), settle.get()));

  useEffect(() => {
    if (reduced) sweep.jump(0);
    if (!active || reduced) return;
    let controls: AnimationPlaybackControls | undefined;
    const pass = (delay: number) => {
      if (sweep.get() >= 1) sweep.jump(0);
      controls = animate(sweep, 1, { duration: SWEEP * (1 - sweep.get()), delay, ease: "linear", onComplete: () => pass(SWEEP * 0.32) });
    };
    pass(sweep.get() > 0 ? 0 : 0.12);
    return () => controls?.stop();
  }, [active, reduced, sweep]);

  useEffect(() => {
    if (active) {
      const dim = animate(settle, 0, { duration: reduced ? 0 : motionTokens.duration.standard, ease: bezier(motionTokens.ease.standard) });
      return () => dim.stop();
    }
    const t = sweep.get();
    const glide = !reduced && t > 0 && t < 1 ? animate(sweep, 1, { duration: Math.min(0.42, SWEEP * (1 - t) * 0.5), ease: bezier(motionTokens.ease.enter) }) : undefined;
    const solid = animate(settle, 1, { duration: reduced ? motionTokens.duration.instant : 0.36, ease: bezier(motionTokens.ease.standard) });
    return () => { glide?.stop(); solid.stop(); };
  }, [active, reduced, sweep, settle]);

  return <motion.span className={styles.shimmer} style={{ backgroundImage }}>{children}</motion.span>;
}

/* ---------------------------------------------------------------------------------------------- */
/* Status icon: one 16px box, icons trade places on the snappy spring, the check draws itself once  */
/* ---------------------------------------------------------------------------------------------- */

function CheckDraw({ draw }: { draw: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <motion.path d="M3.25 8.5 6.5 11.75 12.75 4.75" initial={draw ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={{ duration: 0.32, ease: bezier(motionTokens.ease.enter), delay: 0.04 }} />
    </svg>
  );
}

function StatusIcon({ status, draw, reduced }: { status: ToolCallStatus; draw: boolean; reduced: boolean }) {
  const transition: Transition = reduced ? { duration: 0 } : { ...motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.fast, ease: bezier(motionTokens.ease.standard) } };
  return (
    <span className={styles.statusBox} aria-hidden="true">
      <AnimatePresence initial={false}>
        <motion.span key={status} className={styles.statusIcon} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={transition}>
          {status === "running" && <span className={styles.spinner} />}
          {status === "success" && <CheckDraw draw={draw && !reduced} />}
          {status === "error" && <CircleAlert size={16} strokeWidth={1.75} />}
          {status === "approval" && <Shield size={16} strokeWidth={1.75} />}
          {status === "denied" && <Ban size={16} strokeWidth={1.75} />}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Copy button: confirms in place without changing width, and through the row's live region        */
/* ---------------------------------------------------------------------------------------------- */

function CopyButton({ text, what, announce }: { text: string; what: string; announce: (text: string) => void }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onClick = async () => {
    const ok = await copyText(text);
    setState(ok ? "copied" : "failed");
    announce(ok ? `Copied ${what}` : `Could not copy ${what}`);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1800);
  };
  return (
    <button type="button" className={styles.copy} data-state={state} onClick={onClick} aria-label={`Copy ${what}`}>
      <span className={styles.copyIcon} aria-hidden="true">
        {state === "copied" ? <Check strokeWidth={2} /> : state === "failed" ? <CircleAlert strokeWidth={1.75} /> : <Copy strokeWidth={1.75} />}
      </span>
      <span className={styles.copyLabels} aria-hidden="true">
        <span data-active={state === "idle"}>Copy</span>
        <span data-active={state === "copied"}>Copied</span>
        <span data-active={state === "failed"}>Copy failed</span>
      </span>
    </button>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Fold: fixed row heights, so showing more never measures the DOM                                 */
/* ---------------------------------------------------------------------------------------------- */

function useFold(total: number, visible: number) {
  const [expanded, setExpanded] = useState(false);
  const arm = useArmSelfMotion();
  const folds = total > visible;
  const shown = folds && !expanded ? visible : total;
  const toggle = () => { arm(); setExpanded(value => !value); };
  return { folds, expanded, shown, toggle };
}

function ShowMore({ expanded, hidden, unit, onToggle }: { expanded: boolean; hidden: number; unit: string; onToggle: () => void }) {
  return (
    <button type="button" className={styles.more} aria-expanded={expanded} onClick={onToggle}>
      <ChevronDown strokeWidth={1.75} aria-hidden="true" />
      {expanded ? "Show less" : `Show ${hidden} more ${hidden === 1 ? unit : `${unit}s`}`}
    </button>
  );
}

function foldTransition(reduced: boolean) {
  return reduced ? { duration: 0 } : motionTokens.spring.smooth;
}

/* ---------------------------------------------------------------------------------------------- */
/* Output views                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

function ListView({ items }: { items: ToolCallListItem[] }) {
  return (
    <ol className={styles.list}>
      {items.map((item, i) => (
        <li key={i} className={styles.listItem}>
          <span className={cx(styles.lead, styles.mono)}>{item.lead ?? `${i + 1}.`}</span>
          <span className={styles.itemTitle}>{item.title}</span>
          {item.tag ? <span className={styles.tag}>{item.tag}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function TableView({ columns, rows, reduced }: { columns: string[]; rows: ToolCallCell[][]; reduced: boolean }) {
  const { folds, expanded, shown, toggle } = useFold(rows.length, FOLD_ROWS);
  const numeric = columns.map((_, c) => rows.length > 0 && rows.every(row => typeof row[c] === "number" || row[c] === null));
  return (
    <>
      <div className={styles.scroll}>
        <motion.div className={styles.fold} initial={false} animate={{ height: ROW_HEIGHT + shown * ROW_HEIGHT }} transition={foldTransition(reduced)}>
          <table className={cx(styles.table, styles.mono)}>
            <thead>
              <tr>{columns.map((column, c) => <th key={c} scope="col" data-num={numeric[c]}>{column}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, r) => {
                const hidden = r >= shown;
                return (
                  <tr key={r} aria-hidden={hidden || undefined} inert={hidden || undefined}>
                    {row.map((cell, c) => <td key={c} data-num={numeric[c]} data-kind={cell === null ? "null" : undefined}>{cellText(cell)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </motion.div>
      </div>
      {folds ? <ShowMore expanded={expanded} hidden={rows.length - FOLD_ROWS} unit="row" onToggle={toggle} /> : null}
    </>
  );
}

const jsonToken = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b/g;

function tintJson(line: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  jsonToken.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = jsonToken.exec(line))) {
    if (match.index > last) parts.push(line.slice(last, match.index));
    if (match[1] !== undefined) {
      parts.push(<span key={key++} className={match[2] ? styles.jsonKey : styles.jsonString}>{match[1]}</span>);
      if (match[2]) parts.push(match[2]);
    } else if (match[3] !== undefined) parts.push(<span key={key++} className={styles.jsonNumber}>{match[3]}</span>);
    else if (match[4] !== undefined) parts.push(<span key={key++} className={styles.jsonBoolean}>{match[4]}</span>);
    else parts.push(<span key={key++} className={styles.jsonNull}>{match[5]}</span>);
    last = jsonToken.lastIndex;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

function JsonView({ value, reduced }: { value: ToolCallValue; reduced: boolean }) {
  const lines = useMemo(() => JSON.stringify(value, null, 2).split("\n"), [value]);
  const { folds, expanded, shown, toggle } = useFold(lines.length, FOLD_LINES);
  return (
    <>
      <div className={styles.scroll}>
        <motion.div className={styles.fold} initial={false} animate={{ height: (shown < lines.length ? JSON_PADDING / 2 : JSON_PADDING) + shown * LINE_HEIGHT }} transition={foldTransition(reduced)}>
          <pre className={cx(styles.json, styles.mono)}>
            {lines.map((line, i) => {
              const hidden = i >= shown;
              return <span key={i} className={styles.line} aria-hidden={hidden || undefined} inert={hidden || undefined}>{tintJson(line)}</span>;
            })}
          </pre>
        </motion.div>
      </div>
      {folds ? <ShowMore expanded={expanded} hidden={lines.length - FOLD_LINES} unit="line" onToggle={toggle} /> : null}
    </>
  );
}

function OutputView({ output, reduced }: { output: ToolCallOutput; reduced: boolean }) {
  switch (output.type) {
    case "list": return <ListView items={output.items} />;
    case "table": return <TableView columns={output.columns} rows={output.rows} reduced={reduced} />;
    case "json": return <JsonView value={output.value} reduced={reduced} />;
    case "text": return <p className={styles.textOut}>{output.text}</p>;
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Sample content: a GitHub search on its own, and four settled calls for the group                */
/* ---------------------------------------------------------------------------------------------- */

export const sampleToolCall: ToolCallData = {
  id: "github-search",
  tool: "github",
  title: "Searched issues in arc-ui/web",
  titles: { running: "Searching issues in arc-ui/web" },
  status: "success",
  input: { repo: "arc-ui/web", query: "is:open label:release-blocker", per_page: 10 },
  output: {
    type: "list",
    items: [
      { lead: "#1284", title: "Checkout button stays disabled after a coupon is removed", tag: "checkout" },
      { lead: "#1279", title: "Invoice PDF renders blank for workspaces without a VAT id", tag: "billing" },
      { lead: "#1271", title: "Command menu loses focus after a slow search", tag: "a11y" },
      { lead: "#1266", title: "Dark theme flashes light on first paint in Safari", tag: "theme" },
    ],
  },
  durationMs: 1180,
};

export const sampleToolCalls: ToolCallData[] = [
  sampleToolCall,
  {
    id: "linear-issues",
    tool: "linear",
    title: "Listed issues in the Release 2.4 project",
    titles: { running: "Listing issues in the Release 2.4 project" },
    status: "success",
    input: { project: "Release 2.4", state: ["In progress", "In review"] },
    output: {
      type: "list",
      items: [
        { lead: "ARC-412", title: "Coupon removal leaves the checkout form disabled", tag: "In review" },
        { lead: "ARC-408", title: "Blank invoice PDF when VAT id is empty", tag: "In progress" },
        { lead: "ARC-401", title: "Safari first paint theme flash", tag: "In progress" },
      ],
    },
    durationMs: 860,
  },
  {
    id: "postgres-orders",
    tool: "postgres",
    title: "Queried orders by region for the last 7 days",
    titles: { running: "Querying orders by region for the last 7 days" },
    status: "success",
    input: { database: "analytics", sql: "select region, count(*) as orders, sum(total) as revenue from orders where created_at > now() - interval '7 days' group by 1 order by 3 desc" },
    output: {
      type: "table",
      columns: ["region", "orders", "revenue", "change"],
      rows: [
        ["North America", 4812, 612480, "+4.2%"],
        ["Europe", 3966, 498120, "+2.8%"],
        ["United Kingdom", 1542, 201350, "+1.1%"],
        ["Asia Pacific", 1210, 158900, "+6.5%"],
        ["Latin America", 684, 71220, "-0.8%"],
        ["Middle East", 402, 52310, "+3.3%"],
        ["Africa", 188, 19870, "+0.4%"],
        ["Oceania", 176, 22140, "+1.9%"],
      ],
    },
    durationMs: 640,
  },
  {
    id: "slack-summary",
    tool: "slack",
    title: "Posted a summary to #release",
    titles: { running: "Posting a summary to #release", approval: "Post a summary to #release" },
    status: "success",
    input: { channel: "#release", unfurl_links: false },
    output: { type: "text", text: "Release 2.4 blockers: 4 open issues, 3 already in progress in Linear. Orders are up 3.1% week over week across every region except Latin America." },
    message: "Sends the four blockers and the regional totals to #release as one message.",
    durationMs: 420,
  },
];

/* ---------------------------------------------------------------------------------------------- */
/* ToolCall                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

type Simulated = { base: ToolCallStatus; status: ToolCallStatus; durationMs?: number; message?: string };

/**
 * One inline tool call for an agent or chat transcript: the tool's mark, a verb phrase, quiet meta and a status icon.
 * Clicking the row springs it open into Input (the arguments) and Output (a readable result), each with a copy button.
 * Awaiting approval it shows inline Allow and Deny; on an error it shows the reason and Retry. With no props it renders a sample GitHub search.
 */
export function ToolCall(props: ToolCallProps) {
  // With no tool and no title the row renders the sample GitHub search; any prop passed still overrides the sample.
  const sample = props.tool === undefined && props.title === undefined;
  const {
    id: idProp, tool, title, titles, status: statusProp, input, output, summary: summaryProp, message: messageProp, durationMs: durationProp,
    defaultOpen = false, open: openProp, onOpenChange, onApprove, onDeny, onRetry, renderOutput, className,
  } = sample ? { ...sampleToolCall, ...props } : { ...props, tool: props.tool ?? sampleToolCall.tool, title: props.title ?? sampleToolCall.title, status: props.status ?? "success" as ToolCallStatus };

  const reduced = useReducedMotion() ?? false;
  const uid = useId();
  const panelId = `${uid}-panel`;

  // Without a handler the preview simulates the decision locally and says so. A changed status from the parent always wins.
  const [simulated, setSimulated] = useState<Simulated | null>(null);
  const override = simulated && simulated.base === statusProp ? simulated : null;
  const status = override?.status ?? statusProp;
  const message = override ? override.message : messageProp;
  const durationMs = override ? override.durationMs : durationProp;
  const timers = useRef<number[]>([]);
  useEffect(() => () => { timers.current.forEach(timer => window.clearTimeout(timer)); }, []);
  const later = useCallback((ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); }, []);

  const call = useMemo<ToolCallData>(() => ({ id: idProp ?? uid, tool, title, titles, status, input, output, summary: summaryProp, message, durationMs }), [idProp, uid, tool, title, titles, status, input, output, summaryProp, message, durationMs]);

  // A denied call never ran, so it keeps the imperative approval phrasing rather than the past tense title.
  const label = titles?.[status] ?? (status === "denied" ? titles?.approval : undefined) ?? title;
  const name = toolName(tool);
  const running = status === "running";
  const summary = status === "success" ? summaryProp ?? deriveSummary(output) : undefined;
  const duration = status === "success" || status === "error" ? formatDuration(durationMs) : undefined;
  const sentence = statusSentence(status, summary, duration, message);
  const custom = status === "success" && renderOutput ? renderOutput(call) : undefined;
  const expandable = Boolean(input || output || custom !== undefined);

  // Open state: uncontrolled or controlled. The panel mounts only while open.
  const [openState, setOpenState] = useState(defaultOpen);
  const { inner, height, selfUntil } = useFollowHeight(reduced);
  const open = expandable && (openProp ?? openState);
  const toggle = () => {
    if (!expandable) return;
    const next = !open;
    selfUntil.current = performance.now() + SELF_MOTION_WINDOW;
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  // A polite live region announces status changes, copy results and simulated decisions.
  const [announcement, setAnnouncement] = useState("");
  const announceTimer = useRef<number | undefined>(undefined);
  const announceQueue = useRef<string[]>([]);
  // Messages that arrive within one frame of each other (a simulated decision and the status it causes) are read as one.
  const announce = useCallback((text: string) => {
    announceQueue.current.push(text);
    window.clearTimeout(announceTimer.current);
    setAnnouncement("");
    announceTimer.current = window.setTimeout(() => {
      setAnnouncement(announceQueue.current.join(" "));
      announceQueue.current = [];
    }, 40);
  }, []);
  useEffect(() => () => window.clearTimeout(announceTimer.current), []);

  const previousStatus = useRef(status);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (previousStatus.current === status) return;
    previousStatus.current = status;
    setChanged(true);
    announce(`${name}: ${label}. ${sentence}`);
  }, [status, name, label, sentence, announce]);

  // Keep the shimmer mounted briefly after running ends, so the title settles to solid instead of cutting.
  const [settling, setSettling] = useState(false);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (running) { wasRunning.current = true; setSettling(false); return; }
    if (!wasRunning.current) return;
    wasRunning.current = false;
    setSettling(true);
    const timer = window.setTimeout(() => setSettling(false), 520);
    return () => window.clearTimeout(timer);
  }, [running]);

  const handleApprove = () => {
    if (onApprove) { onApprove(); return; }
    const base = statusProp;
    setSimulated({ base, status: "running" });
    announce("Allowed. No handler is wired, so this preview simulates the call.");
    later(900 + Math.random() * 500, () => setSimulated({ base, status: "success", durationMs: Math.round(700 + Math.random() * 600) }));
  };
  const handleDeny = () => {
    if (onDeny) { onDeny(); return; }
    setSimulated({ base: statusProp, status: "denied" });
    announce("Denied. No handler is wired, so this preview marks the call denied locally.");
  };
  const handleRetry = () => {
    if (onRetry) { onRetry(); return; }
    const base = statusProp;
    setSimulated({ base, status: "running" });
    announce("Retrying. No handler is wired, so this preview simulates a successful retry.");
    later(900 + Math.random() * 500, () => setSimulated({ base, status: "success", durationMs: Math.round(500 + Math.random() * 700) }));
  };

  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; }, []);
  const panelTransition: Transition = reduced ? { duration: 0 } : { ...motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast, ease: bezier(motionTokens.ease.standard) } };

  return (
    <SelfMotionContext.Provider value={selfUntil}>
      <motion.div className={cx(styles.call, className)} data-status={status} data-open={open || undefined} style={{ height }}>
        <div ref={inner} className={styles.inner}>
          <button
            type="button"
            className={styles.row}
            data-static={expandable ? undefined : "true"}
            aria-expanded={expandable ? open : undefined}
            aria-controls={expandable ? panelId : undefined}
            aria-label={`${name}: ${label} ${sentence}`}
            onClick={toggle}
          >
            <span className={styles.mark} aria-hidden="true">{toolMark(tool)}</span>
            <span className={styles.text}>
              <span className={styles.title}>
                <motion.span
                  key={label}
                  className={styles.titleLabel}
                  initial={mounted.current && !reduced ? { opacity: 0, y: 3 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: motionTokens.duration.fast, ease: bezier(motionTokens.ease.enter) }}
                >
                  {running || settling ? <Shimmer active={running} reduced={reduced}>{label}</Shimmer> : label}
                </motion.span>
              </span>
              <ChevronRight className={styles.chevron} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className={styles.meta} aria-hidden="true">
              {summary ? <span className={styles.summary}>{summary}</span> : null}
              {summary && duration ? <span className={styles.dot} /> : null}
              {duration ? <span>{duration}</span> : null}
              {status === "denied" ? <span>Not run</span> : null}
            </span>
            <StatusIcon status={status} draw={changed} reduced={reduced} />
          </button>

          {status === "approval" ? (
            <div className={styles.actions}>
              <button type="button" className={cx(styles.action, styles.deny)} onClick={handleDeny} aria-label={`Deny: ${label}`}>Deny</button>
              <button type="button" className={cx(styles.action, styles.allow)} onClick={handleApprove} aria-label={`Allow: ${label}`}>Allow</button>
            </div>
          ) : status === "error" ? (
            <div className={styles.actions}>
              <button type="button" className={cx(styles.action, styles.retry)} onClick={handleRetry} aria-label={`Retry: ${label}`}>Retry</button>
            </div>
          ) : null}

          {message && (status === "error" || status === "approval") ? <p className={styles.message}>{message}</p> : null}

          <AnimatePresence initial={false}>
            {open ? (
              <motion.div key="panel" id={panelId} className={styles.panel} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={panelTransition}>
                <div className={styles.panelInner}>
                  {input ? (
                    <div className={styles.section}>
                      <div className={styles.sectionHead}>
                        <span className={styles.sectionLabel} id={`${uid}-input`}>Input</span>
                        <CopyButton text={JSON.stringify(input, null, 2)} what="input" announce={announce} />
                      </div>
                      <div className={styles.well}>
                        <dl className={cx(styles.kv, styles.mono)} aria-labelledby={`${uid}-input`}>
                          {Object.entries(input).map(([key, value]) => (
                            <div key={key} className={styles.kvRow}>
                              <dt>{key}</dt>
                              <dd data-kind={valueKind(value)}>{valueText(value)}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    </div>
                  ) : null}
                  <div className={styles.section}>
                    <div className={styles.sectionHead}>
                      <span className={styles.sectionLabel}>Output</span>
                      {output && custom === undefined && status !== "denied" && status !== "approval" ? <CopyButton text={outputText(output)} what="output" announce={announce} /> : null}
                    </div>
                    <div className={styles.well}>
                      {custom !== undefined ? <div className={styles.custom}>{custom}</div>
                        : output && status !== "denied" && status !== "approval" ? <OutputView output={output} reduced={reduced} />
                        : <p className={styles.empty}>{emptyOutput[status]}</p>}
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
        <span className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
      </motion.div>
    </SelfMotionContext.Provider>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* ToolCallGroup                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

function GroupRow({ children, index, appended, reduced }: { children: ReactNode; index: number; appended: boolean; reduced: boolean }) {
  const transition: Transition = reduced
    ? { duration: 0 }
    : appended
      ? { ...motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast, ease: bezier(motionTokens.ease.standard) } }
      : { duration: motionTokens.duration.standard, ease: bezier(motionTokens.ease.enter), delay: index * 0.02 };
  return (
    <motion.div
      className={styles.listRow}
      initial={appended ? { height: 0, opacity: 0 } : { opacity: 0, y: 6 }}
      animate={appended ? { height: "auto", opacity: 1 } : { opacity: 1, y: 0 }}
      exit={{ height: 0, opacity: 0, transition: reduced ? { duration: 0 } : { duration: motionTokens.duration.exit, ease: bezier(motionTokens.ease.exit) } }}
      transition={transition}
    >
      {children}
    </motion.div>
  );
}

function GroupList({ calls, reduced, onTouch, onApprove, onDeny, onRetry, renderOutput }: {
  calls: ToolCallData[];
  reduced: boolean;
  onTouch: () => void;
  onApprove?: (call: ToolCallData) => void;
  onDeny?: (call: ToolCallData) => void;
  onRetry?: (call: ToolCallData) => void;
  renderOutput?: (call: ToolCallData) => ReactNode | undefined;
}) {
  // Rows present when the list opened stagger in; rows appended by a live run grow in from zero height instead.
  const [initialIds] = useState(() => new Set(calls.map(call => call.id)));
  return (
    <div className={styles.listBody}>
      <AnimatePresence>
        {calls.map((call, index) => (
          <GroupRow key={call.id} index={index} appended={!initialIds.has(call.id)} reduced={reduced}>
            <ToolCall
              {...call}
              onOpenChange={onTouch}
              onApprove={onApprove ? () => onApprove(call) : undefined}
              onDeny={onDeny ? () => onDeny(call) : undefined}
              onRetry={onRetry ? () => onRetry(call) : undefined}
              renderOutput={renderOutput}
            />
          </GroupRow>
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * Several calls from one assistant turn under a quiet header, "Used 4 tools", with an overlapping stack of the tools' marks and the total duration.
 * Opening it staggers the rows in; while the agent works the header reads "Using 3 tools" with a shimmer. A call that needs a decision opens a closed group,
 * and the group folds itself away once every call has finished unless the person has opened or closed anything.
 */
export function ToolCallGroup({ calls = sampleToolCalls, active, defaultOpen, open: openProp, onOpenChange, autoCollapse = true, onApprove, onDeny, onRetry, renderOutput, className }: ToolCallGroupProps) {
  const reduced = useReducedMotion() ?? false;
  const uid = useId();
  const listId = `${uid}-list`;

  const anyRunning = calls.some(call => call.status === "running");
  const working = active ?? anyRunning;
  const unsettled = calls.some(call => call.status === "running" || call.status === "approval" || call.status === "error");
  const needsDecision = calls.some(call => call.status === "approval");
  const settled = !working && calls.every(call => call.status === "success" || call.status === "denied");

  const controlled = openProp !== undefined;
  const [openState, setOpenState] = useState(defaultOpen ?? unsettled);
  const open = controlled ? openProp : openState;
  const openRef = useRef(open);
  openRef.current = open;
  const touched = useRef(false);

  const setOpen = useCallback((next: boolean, byPerson: boolean) => {
    if (byPerson) touched.current = true;
    if (!controlled) setOpenState(next);
    onOpenChange?.(next);
  }, [controlled, onOpenChange]);
  const touch = useCallback(() => { touched.current = true; }, []);
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;

  // A call that starts waiting for a decision opens a closed, uncontrolled group on its own. Closing it again by hand is respected.
  const hadDecision = useRef(needsDecision);
  useEffect(() => {
    const rose = needsDecision && !hadDecision.current;
    hadDecision.current = needsDecision;
    if (rose && !controlled && !openRef.current) setOpenRef.current(true, false);
  }, [needsDecision, controlled]);

  // Once every call has finished, fold the list away so the answer reads right under the header, unless the person has touched anything.
  const sawWork = useRef(!settled);
  useEffect(() => {
    if (!settled) { sawWork.current = true; return; }
    if (!sawWork.current) return;
    sawWork.current = false;
    if (!autoCollapse || touched.current || !openRef.current) return;
    const timer = window.setTimeout(() => { if (!touched.current && openRef.current) setOpenRef.current(false, false); }, 450);
    return () => window.clearTimeout(timer);
  }, [settled, autoCollapse]);

  const tools = useMemo(() => {
    const seen = new Map<string, ToolCallTool>();
    for (const call of calls) { const key = toolKey(call.tool); if (!seen.has(key)) seen.set(key, call.tool); }
    return Array.from(seen, ([key, tool]) => ({ key, tool }));
  }, [calls]);
  const stackWidth = tools.length ? MARK_SIZE + (tools.length - 1) * MARK_STEP : 0;
  const total = calls.reduce((sum, call) => sum + (call.durationMs ?? 0), 0);
  const totalLabel = total > 0 ? formatDuration(total) : undefined;
  const count = calls.length;
  const headline = `${working ? "Using" : "Used"} ${plural(count, "tool")}`;

  const listTransition: Transition = reduced ? { duration: 0 } : { ...motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast, ease: bezier(motionTokens.ease.standard) } };

  return (
    <div className={cx(styles.group, className)}>
      <button type="button" className={styles.groupHead} aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open, true)}>
        <motion.span className={styles.stack} aria-hidden="true" initial={false} animate={{ width: stackWidth }} transition={reduced ? { duration: 0 } : motionTokens.spring.morph}>
          <AnimatePresence initial={false}>
            {tools.map(({ key, tool }, index) => (
              <motion.span
                key={key}
                className={styles.stackMark}
                style={{ left: index * MARK_STEP }}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}
              >
                {toolMark(tool)}
              </motion.span>
            ))}
          </AnimatePresence>
        </motion.span>
        <span className={styles.groupLabel}>{working ? <Shimmer active reduced={reduced}>{headline}</Shimmer> : headline}</span>
        <ChevronRight className={styles.chevron} strokeWidth={2} aria-hidden="true" />
        {totalLabel ? <span className={styles.groupMeta}>{totalLabel}</span> : null}
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div key="list" id={listId} className={styles.groupList} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={listTransition}>
            <GroupList calls={calls} reduced={reduced} onTouch={touch} onApprove={onApprove} onDeny={onDeny} onRetry={onRetry} renderOutput={renderOutput} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default ToolCall;
