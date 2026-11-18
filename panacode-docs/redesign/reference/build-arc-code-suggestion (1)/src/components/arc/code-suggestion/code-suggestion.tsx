import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import { Check, CircleAlert, CircleDot, RotateCcw, Square, X } from "lucide-react";
import { Button } from "../ui/button";
import { cx, motionTokens } from "../ui/motion-tokens";
import { TextShimmer } from "../ui/text-shimmer";
import { ClaudeMark, TypeScriptMark } from "./code-suggestion-marks";
import { CodeLine } from "./highlight";
import { SAMPLE_CODE, SAMPLE_HUNKS } from "./sample";
import "./code-suggestion.css";

/* ───────────────────────── Types ───────────────────────── */

export type CodeSuggestionHunk = {
  id: string;
  /** Zero based line where the change starts. */
  start: number;
  /** Lines replaced from `start`. 0 inserts before `start`. */
  remove?: number;
  /** Lines added. Empty deletes. */
  insert?: string[];
  /** Two to six words on what the hunk does. */
  summary?: string;
};

export type CodeSuggestionStatus = "thinking" | "streaming" | "ready" | "error";
export type CodeSuggestionDecision = "accepted" | "rejected";

export type CodeSuggestionProps = {
  code?: string;
  hunks?: CodeSuggestionHunk[];
  status?: CodeSuggestionStatus;
  instruction?: string;
  model?: { name: string; mark?: ReactNode } | null;
  fileName?: string;
  filePath?: string;
  fileMark?: ReactNode | null;
  error?: string;
  onDecision?: (hunk: CodeSuggestionHunk, decision: CodeSuggestionDecision, code: string) => void;
  onResolve?: (result: { code: string; accepted: string[]; rejected: string[] }) => void;
  onStop?: () => void;
  onRegenerate?: () => void;
  autoPlay?: boolean;
  shortcuts?: boolean;
  maxCodeHeight?: number;
  className?: string;
  style?: CSSProperties;
};

type Hunk = {
  id: string;
  start: number;
  remove: number;
  insert: string[];
  summary?: string;
  source: CodeSuggestionHunk;
};

type Decisions = Partial<Record<string, CodeSuggestionDecision>>;
type RowDecision = CodeSuggestionDecision | "pending";

type Row =
  | { kind: "ctx" | "add" | "del"; key: string; text: string; decision?: RowDecision; num?: number }
  | { kind: "bar"; key: string; hunk: Hunk; index: number };

type Simulation = {
  phase: "idle" | "thinking" | "streaming" | "ready";
  step: number;
  stopped: boolean;
  run: number;
};

type Tone = "busy" | "review" | "done" | "muted" | "error";

/* ───────────────────────── Constants ───────────────────────── */

const ROW_HEIGHT = 20;
const BAR_HEIGHT = 40;

/** Simulated suggestion timings, in milliseconds. */
const THINKING_MS = 820;
const HUNK_GAP_MS = 150;
const FIRST_LINE_AFTER_REMOVAL_MS = 190;
const FIRST_LINE_MS = 75;
const LINE_MS = 38;
const SETTLE_MS = 140;
const PRESS_MS = 170;
const REPLAY_MS = 2600;

const DEFAULT_MODEL = {
  name: "Claude Sonnet 5.5",
  mark: <ClaudeMark aria-hidden="true" style={{ color: "#D97757" }} />,
};

const DEFAULT_ERROR = "The model stopped responding. Nothing was changed.";

/* ───────────────────────── Helpers ───────────────────────── */

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Sorts hunks, clamps them to the file and drops any that overlap an earlier one. */
function normalizeHunks(hunks: CodeSuggestionHunk[], lineCount: number): Hunk[] {
  const sorted = [...hunks].sort((a, b) => a.start - b.start);
  const result: Hunk[] = [];
  let cursor = 0;
  for (const hunk of sorted) {
    const start = Math.min(Math.max(0, Math.floor(hunk.start)), lineCount);
    if (start < cursor) continue;
    const remove = Math.min(Math.max(0, hunk.remove ?? 0), lineCount - start);
    result.push({
      id: hunk.id,
      start,
      remove,
      insert: hunk.insert ?? [],
      summary: hunk.summary,
      source: hunk,
    });
    cursor = start + remove;
  }
  return result;
}

/** The file as it stands: accepted hunks applied, everything else original. */
function applyDecisions(lines: string[], hunks: Hunk[], decisions: Decisions): string {
  const out: string[] = [];
  let cursor = 0;
  for (const hunk of hunks) {
    out.push(...lines.slice(cursor, hunk.start));
    if (decisions[hunk.id] === "accepted") out.push(...hunk.insert);
    else out.push(...lines.slice(hunk.start, hunk.start + hunk.remove));
    cursor = hunk.start + hunk.remove;
  }
  out.push(...lines.slice(cursor));
  return out.join("\n");
}

const noopSubscribe = () => () => {};
const readPlatform = (): "mac" | "pc" => {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent)
    ? "mac"
    : "pc";
};
const usePlatform = () => useSyncExternalStore(noopSubscribe, readPlatform, () => "mac" as const);

function Spinner() {
  return (
    <svg className="cs-spinner" width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity=".2" strokeWidth="1.75" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

/* ───────────────────────── Component ───────────────────────── */

export function CodeSuggestion({
  code,
  hunks,
  status,
  instruction = "Add retry with backoff",
  model = DEFAULT_MODEL,
  fileName = "fetch-invoice.ts",
  filePath,
  fileMark,
  error,
  onDecision,
  onResolve,
  onStop,
  onRegenerate,
  autoPlay = true,
  shortcuts = true,
  maxCodeHeight,
  className,
  style,
}: CodeSuggestionProps) {
  const reduced = useReducedMotion() ?? false;
  const platform = usePlatform();

  /** With no hunks passed, the card plays its built-in simulated suggestion. */
  const simulated = hunks === undefined;
  const folder = filePath ?? (simulated ? "src/billing" : undefined);
  const source = code ?? (simulated ? SAMPLE_CODE : "");
  const lines = useMemo(() => source.split("\n"), [source]);
  const allHunks = useMemo(
    () => normalizeHunks(hunks ?? SAMPLE_HUNKS, lines.length),
    [hunks, lines.length],
  );

  /** One step opens a hunk (lines: 0) or streams one more of its new lines. */
  const steps = useMemo(() => {
    const list: Array<{ hunk: number; lines: number }> = [];
    allHunks.forEach((hunk, index) => {
      list.push({ hunk: index, lines: 0 });
      hunk.insert.forEach((_, line) => list.push({ hunk: index, lines: line + 1 }));
    });
    return list;
  }, [allHunks]);

  const rootRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);

  const [sim, setSim] = useState<Simulation>({ phase: "idle", step: 0, stopped: false, run: 0 });
  const [touched, setTouched] = useState(false);
  const [pressing, setPressing] = useState<string | null>(null);
  const inView = useRef(false);
  const replayWaiting = useRef(false);

  const restart = useCallback(
    (byPerson: boolean) => {
      replayWaiting.current = false;
      if (byPerson) setTouched(true);
      setSim((current) => ({
        phase: reduced ? "ready" : "thinking",
        step: 0,
        stopped: false,
        run: current.run + 1,
      }));
    },
    [reduced],
  );

  // The simulation starts when the card is in view, and replays wait for it to return.
  useEffect(() => {
    if (!simulated) return;
    const begin = (phase: Simulation["phase"]) =>
      setSim((current) => (current.phase === "idle" ? { ...current, phase } : current));
    const root = rootRef.current;
    if (reduced || !root || typeof IntersectionObserver === "undefined") {
      inView.current = true;
      const frame = requestAnimationFrame(() => begin(reduced ? "ready" : "thinking"));
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView.current = entry.isIntersecting;
        if (!entry.isIntersecting) return;
        begin("thinking");
        if (replayWaiting.current) restart(false);
      },
      { threshold: 0.35 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [simulated, reduced, restart]);

  // A single timeout per step drives thinking and streaming.
  useEffect(() => {
    if (!simulated) return;
    let timer: number | undefined;
    if (sim.phase === "thinking") {
      timer = window.setTimeout(
        () => setSim((current) => ({ ...current, phase: "streaming", step: 0 })),
        THINKING_MS,
      );
    } else if (sim.phase === "streaming") {
      if (sim.step >= steps.length) {
        timer = window.setTimeout(
          () => setSim((current) => ({ ...current, phase: "ready" })),
          SETTLE_MS,
        );
      } else {
        const next = steps[sim.step];
        const delay =
          next.lines === 0
            ? sim.step === 0
              ? 0
              : HUNK_GAP_MS
            : next.lines === 1
              ? allHunks[next.hunk].remove
                ? FIRST_LINE_AFTER_REMOVAL_MS
                : FIRST_LINE_MS
              : LINE_MS;
        timer = window.setTimeout(
          () => setSim((current) => ({ ...current, step: current.step + 1 })),
          delay,
        );
      }
    }
    return () => window.clearTimeout(timer);
  }, [simulated, sim.phase, sim.step, steps, allHunks]);

  const currentStatus: CodeSuggestionStatus = simulated
    ? sim.phase === "idle"
      ? "thinking"
      : sim.phase
    : (status ?? "ready");

  /** The hunks on screen: everything when controlled, what has streamed so far when simulated. */
  const visibleHunks = useMemo(() => {
    if (!simulated) return allHunks;
    if (sim.phase === "idle" || sim.phase === "thinking") return [];
    if (sim.phase === "ready" && !sim.stopped) return allHunks;
    const reached = steps[sim.step - 1];
    if (!reached) return [];
    if (sim.phase === "ready") {
      // Stopped early: keep only the hunks that finished streaming.
      const finished = reached.lines === allHunks[reached.hunk].insert.length;
      return allHunks.slice(0, finished ? reached.hunk + 1 : reached.hunk);
    }
    return allHunks
      .slice(0, reached.hunk + 1)
      .map((hunk, index) =>
        index === reached.hunk ? { ...hunk, insert: hunk.insert.slice(0, reached.lines) } : hunk,
      );
  }, [simulated, allHunks, steps, sim.phase, sim.step, sim.stopped]);

  const [decisions, setDecisions] = useState<Decisions>({});
  const decisionsRef = useRef(decisions);
  const [announcement, setAnnouncement] = useState("");
  const [seenRun, setSeenRun] = useState(sim.run);

  // A new run, or a controlled card going back to thinking, clears earlier decisions.
  if (
    seenRun !== sim.run ||
    (!simulated && currentStatus === "thinking" && Object.keys(decisions).length > 0)
  ) {
    setSeenRun(sim.run);
    setDecisions({});
    setAnnouncement("");
  }

  useEffect(() => {
    decisionsRef.current = decisions;
  }, [decisions]);

  const callbacks = useRef({ onDecision, onResolve });
  useEffect(() => {
    callbacks.current = { onDecision, onResolve };
  });

  const decisionOf = (id: string): RowDecision => decisions[id] ?? "pending";
  const pendingIds =
    currentStatus === "ready"
      ? visibleHunks.filter((hunk) => decisionOf(hunk.id) === "pending").map((hunk) => hunk.id)
      : [];
  const acceptedCount = visibleHunks.filter((hunk) => decisionOf(hunk.id) === "accepted").length;
  const rejectedCount = visibleHunks.filter((hunk) => decisionOf(hunk.id) === "rejected").length;
  const resolved = currentStatus === "ready" && visibleHunks.length > 0 && pendingIds.length === 0;

  const decide = useCallback(
    (ids: string[], decision: CodeSuggestionDecision, moveFocus = false) => {
      const next: Decisions = { ...decisionsRef.current };
      const fresh = ids.filter((id) => !next[id]);
      if (!fresh.length) return;
      for (const id of fresh) next[id] = decision;
      decisionsRef.current = next;
      setDecisions(next);

      const verb = decision === "accepted" ? "Accepted" : "Rejected";
      const first = visibleHunks.find((hunk) => hunk.id === fresh[0]);
      setAnnouncement(
        fresh.length > 1
          ? `${verb} ${fresh.length} changes`
          : `${verb}: ${first?.summary ?? `change ${first ? visibleHunks.indexOf(first) + 1 : 1}`}`,
      );

      const nextCode = applyDecisions(lines, visibleHunks, next);
      for (const id of fresh) {
        const hunk = visibleHunks.find((item) => item.id === id);
        if (hunk) callbacks.current.onDecision?.(hunk.source, decision, nextCode);
      }
      if (visibleHunks.every((hunk) => next[hunk.id])) {
        callbacks.current.onResolve?.({
          code: nextCode,
          accepted: visibleHunks.filter((hunk) => next[hunk.id] === "accepted").map((hunk) => hunk.id),
          rejected: visibleHunks.filter((hunk) => next[hunk.id] === "rejected").map((hunk) => hunk.id),
        });
      }

      // The pressed control leaves with its hunk: hand focus to the next pending
      // Accept, or to the code area, so it never falls back to the page.
      if (moveFocus) {
        requestAnimationFrame(() => {
          const root = rootRef.current;
          if (!root) return;
          const active = document.activeElement;
          if (!root.contains(active) && active !== document.body) return;
          const nextId = visibleHunks.find((hunk) => !next[hunk.id])?.id;
          const target = nextId
            ? root.querySelector<HTMLElement>(`[data-accept="${CSS.escape(nextId)}"]`)
            : null;
          (target ?? codeRef.current)?.focus({ preventScroll: true });
        });
      }
    },
    [visibleHunks, lines],
  );

  const acceptAll = useCallback(
    (moveFocus = false) => decide(visibleHunks.map((hunk) => hunk.id), "accepted", moveFocus),
    [decide, visibleHunks],
  );
  const rejectAll = useCallback(
    (moveFocus = false) => decide(visibleHunks.map((hunk) => hunk.id), "rejected", moveFocus),
    [decide, visibleHunks],
  );

  /* ── Autoplay: the sample reviews itself until someone touches the card ── */

  const autoplaying = simulated && autoPlay && !reduced && !touched;

  useEffect(() => {
    if (!autoplaying || sim.phase !== "ready" || sim.stopped) return;
    const timers: number[] = [];
    const at = (ms: number, run: () => void) => timers.push(window.setTimeout(run, ms));
    const press = (ms: number, control: string, run: () => void) => {
      at(ms, () => setPressing(control));
      at(ms + PRESS_MS, () => {
        setPressing(null);
        run();
      });
    };

    if (sim.run % 2 === 0) {
      // One by one: accept, accept, reject, then accept whatever is left.
      const [first, second, third] = allHunks;
      if (first) press(1300, `accept:${first.id}`, () => decide([first.id], "accepted"));
      if (second) press(2150, `accept:${second.id}`, () => decide([second.id], "accepted"));
      if (third) press(3000, `reject:${third.id}`, () => decide([third.id], "rejected"));
      allHunks.slice(3).forEach((hunk, index) => {
        press(3850 + 850 * index, `accept:${hunk.id}`, () => decide([hunk.id], "accepted"));
      });
    } else {
      press(1500, "accept-all", () => decide(allHunks.map((hunk) => hunk.id), "accepted"));
    }

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      setPressing(null);
    };
  }, [autoplaying, sim.phase, sim.stopped, sim.run, allHunks, decide]);

  useEffect(() => {
    if (!autoplaying || !resolved) return;
    const timer = window.setTimeout(() => {
      if (inView.current) restart(false);
      else replayWaiting.current = true;
    }, REPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [autoplaying, resolved, restart]);

  /** Any pointer, key or focus inside the card hands control to the person. */
  const takeOver = () => {
    if (autoplaying) setTouched(true);
  };

  /* ── Rows ── */

  const rows = useMemo(() => {
    const list: Row[] = [];
    let cursor = 0;
    const context = (until: number) => {
      for (; cursor < until; cursor++) {
        list.push({ kind: "ctx", key: `c${cursor}`, text: lines[cursor] });
      }
    };

    visibleHunks.forEach((hunk, index) => {
      context(hunk.start);
      const decision: RowDecision = decisions[hunk.id] ?? "pending";
      // Removed lines keep the key of the line they were, so they tint in place.
      if (decision !== "accepted") {
        for (let offset = 0; offset < hunk.remove; offset++) {
          const line = hunk.start + offset;
          list.push({ kind: "del", key: `c${line}`, text: lines[line], decision });
        }
      }
      if (decision !== "rejected") {
        hunk.insert.forEach((text, line) => {
          list.push({ kind: "add", key: `${hunk.id}+${line}`, text, decision });
        });
      }
      if (currentStatus === "ready" && decision === "pending") {
        list.push({ kind: "bar", key: `${hunk.id}-bar`, hunk, index });
      }
      cursor = hunk.start + hunk.remove;
    });
    context(lines.length);

    // Number the lines the file would have: pending removals carry no number.
    let num = 0;
    for (const row of list) {
      if (row.kind === "bar") continue;
      if (
        row.kind === "ctx" ||
        (row.kind === "add" && row.decision !== "rejected") ||
        (row.kind === "del" && row.decision === "rejected")
      ) {
        row.num = ++num;
      }
    }
    return list;
  }, [visibleHunks, lines, decisions, currentStatus]);

  const added = visibleHunks.reduce(
    (sum, hunk) => sum + (decisionOf(hunk.id) === "rejected" ? 0 : hunk.insert.length),
    0,
  );
  const removed = visibleHunks.reduce(
    (sum, hunk) => sum + (decisionOf(hunk.id) === "rejected" ? 0 : hunk.remove),
    0,
  );

  /* ── Status ── */

  const stoppedEarly = simulated && sim.stopped;
  let tone: Tone = "busy";
  let label: string;
  if (currentStatus === "thinking") {
    label = `Reading ${fileName}`;
  } else if (currentStatus === "streaming") {
    label = "Writing changes";
  } else if (currentStatus === "error") {
    tone = "error";
    label = error ?? DEFAULT_ERROR;
  } else if (!visibleHunks.length) {
    tone = "muted";
    label = stoppedEarly ? "Stopped before any changes" : "No changes needed";
  } else if (pendingIds.length) {
    tone = "review";
    label = stoppedEarly
      ? `Stopped early, ${plural(pendingIds.length, "change")} to review`
      : `${plural(pendingIds.length, "change")} to review`;
  } else if (acceptedCount === visibleHunks.length) {
    tone = "done";
    label = visibleHunks.length === 1 ? "Change applied" : "All changes applied";
  } else if (rejectedCount === visibleHunks.length) {
    tone = "muted";
    label = "Suggestion rejected";
  } else {
    tone = "done";
    label = `${acceptedCount} applied, ${rejectedCount} rejected`;
  }

  const allRejected =
    currentStatus === "ready" && visibleHunks.length > 0 && rejectedCount === visibleHunks.length;
  /** The icon swaps only when its kind changes, so the spinner keeps turning. */
  const iconKind = tone === "muted" && allRejected ? "rejected" : tone;
  const icon =
    iconKind === "busy" ? (
      <Spinner />
    ) : iconKind === "review" ? (
      <CircleDot size={16} strokeWidth={1.75} />
    ) : iconKind === "done" ? (
      <Check size={16} strokeWidth={2} />
    ) : iconKind === "error" ? (
      <CircleAlert size={16} strokeWidth={1.75} />
    ) : iconKind === "rejected" ? (
      <X size={16} strokeWidth={1.75} />
    ) : (
      <Check size={16} strokeWidth={1.75} />
    );

  // Streaming is announced once, not per line.
  const liveMessage =
    currentStatus === "streaming"
      ? "Writing changes"
      : [announcement, label, resolved && simulated ? "Simulated, nothing was written to disk" : ""]
          .filter(Boolean)
          .join(". ");

  const canStop =
    (currentStatus === "thinking" || currentStatus === "streaming") && (simulated || !!onStop);
  const canRegenerate = simulated || !!onRegenerate;
  const actions: "busy" | "error" | "review" | "done" | "none" = canStop
    ? "busy"
    : currentStatus === "error"
      ? canRegenerate
        ? "error"
        : "none"
      : pendingIds.length
        ? "review"
        : currentStatus === "ready" && canRegenerate
          ? "done"
          : "none";

  const focusCode = () =>
    requestAnimationFrame(() => codeRef.current?.focus({ preventScroll: true }));

  // Review bars stay pinned to the visible width while long lines scroll sideways.
  useEffect(() => {
    const area = codeRef.current;
    if (!area || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      area.style.setProperty("--cs-viewport", `${area.clientWidth}px`),
    );
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  /* ── Motion ── */

  const instant: Transition = { duration: 0 };
  const lineIn: Transition = reduced
    ? instant
    : {
        height: { duration: 0.12, ease: motionTokens.ease.enter },
        opacity: { duration: 0.15, ease: "easeOut" },
      };
  const fold: Transition = reduced
    ? instant
    : {
        height: { type: "spring", visualDuration: 0.26, bounce: 0 },
        opacity: { duration: 0.12, ease: "easeOut" },
      };
  const barIn: Transition = reduced
    ? instant
    : {
        height: { type: "spring", visualDuration: 0.24, bounce: 0 },
        opacity: { duration: 0.16, ease: "easeOut" },
      };
  const swapIn: Transition = reduced
    ? instant
    : { duration: motionTokens.duration.fast, ease: motionTokens.ease.standard };
  const swapOut: Transition = reduced ? instant : { duration: 0.1, ease: "easeOut" };

  const mark = fileMark === undefined ? <TypeScriptMark aria-hidden="true" /> : fileMark;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    takeOver();
    if (!shortcuts || !(event.metaKey || event.ctrlKey)) return;
    if (currentStatus !== "ready" || !pendingIds.length) return;
    if (event.key === "Enter") {
      event.preventDefault();
      acceptAll(true);
    } else if (event.key === "Backspace") {
      event.preventDefault();
      rejectAll(true);
    }
  };

  const renderRow = (row: Row) => {
    if (row.kind === "bar") {
      const { hunk, index } = row;
      const name = hunk.summary ?? `change ${index + 1}`;
      return (
        <motion.div
          key={row.key}
          className="cs-bar-row"
          data-hunk-bar=""
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: BAR_HEIGHT, opacity: 1 }}
          exit={{ height: 0, opacity: 0, transition: fold }}
          transition={barIn}
        >
          <div className="cs-bar">
            <span className="cs-bar-summary">
              {hunk.summary ?? `Change ${index + 1} of ${visibleHunks.length}`}
            </span>
            <div className="cs-bar-actions">
              <Button
                size="sm"
                variant="ghost"
                className="cs-hunk-button cs-reject"
                data-pressing={pressing === `reject:${hunk.id}` || undefined}
                aria-label={`Reject ${name}`}
                onClick={() => decide([hunk.id], "rejected", true)}
              >
                Reject
              </Button>
              <Button
                size="sm"
                variant="primary"
                className="cs-hunk-button cs-accept"
                data-pressing={pressing === `accept:${hunk.id}` || undefined}
                data-accept={hunk.id}
                aria-label={`Accept ${name}`}
                onClick={() => decide([hunk.id], "accepted", true)}
              >
                Accept
              </Button>
            </div>
          </div>
        </motion.div>
      );
    }

    const decision = row.kind === "ctx" ? undefined : row.decision;
    return (
      <motion.div
        key={row.key}
        className="cs-row"
        data-kind={row.kind}
        data-decision={decision}
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: ROW_HEIGHT, opacity: 1 }}
        exit={{ height: 0, opacity: 0, transition: fold }}
        transition={lineIn}
      >
        <span className="cs-gutter" aria-hidden="true">
          <span className="cs-num">{row.num ?? ""}</span>
          <span className="cs-sign">{row.kind === "add" ? "+" : row.kind === "del" ? "−" : ""}</span>
        </span>
        {row.kind !== "ctx" && decision === "pending" ? (
          <span className="cs-sr-only">{row.kind === "add" ? "Added: " : "Removed: "}</span>
        ) : null}
        <CodeLine text={row.text} />
      </motion.div>
    );
  };

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={`Code suggestion: ${instruction}`}
      className={cx("cs-root", className)}
      style={style}
      data-status={currentStatus}
      onKeyDown={onKeyDown}
      onPointerMove={takeOver}
      onPointerDown={takeOver}
      onFocus={takeOver}
    >
      <header className="cs-header">
        <span className="cs-model-mark" aria-hidden="true">
          {model?.mark}
        </span>
        <p className="cs-instruction">{instruction}</p>
        {model ? <p className="cs-model">{model.name}</p> : null}
      </header>

      <div className="cs-editor">
        <div className="cs-tabs">
          <span className="cs-tab">
            {mark ? (
              <span className="cs-file-mark" aria-hidden="true">
                {mark}
              </span>
            ) : null}
            <span className="cs-file-name">{fileName}</span>
            {folder ? <span className="cs-file-path">{folder}</span> : null}
          </span>
          <span className="cs-stats">
            <span className="cs-sr-only">{`${added} lines added, ${removed} removed`}</span>
            <span className="cs-stat-add" data-zero={added === 0 || undefined} aria-hidden="true">
              +{added}
            </span>
            <span className="cs-stat-del" data-zero={removed === 0 || undefined} aria-hidden="true">
              −{removed}
            </span>
          </span>
        </div>

        <div
          ref={codeRef}
          className="cs-code"
          tabIndex={0}
          role="region"
          aria-label={`Suggested changes to ${fileName}`}
          style={maxCodeHeight ? { maxHeight: maxCodeHeight, overflowY: "auto" } : undefined}
        >
          <div className="cs-lines">
            <AnimatePresence initial={false}>{rows.map(renderRow)}</AnimatePresence>
          </div>
        </div>
      </div>

      <div className="cs-footer">
        <div className="cs-status" aria-hidden="true">
          <span className="cs-status-icon">
            <AnimatePresence initial={false}>
              <motion.span
                key={iconKind}
                data-tone={tone}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: swapOut }}
                transition={swapIn}
              >
                {icon}
              </motion.span>
            </AnimatePresence>
          </span>
          <span className="cs-status-label">
            <AnimatePresence initial={false}>
              <motion.span
                key={label}
                data-tone={tone}
                initial={{ opacity: 0, y: reduced ? 0 : 2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: swapOut }}
                transition={swapIn}
              >
                {tone === "busy" ? (
                  <TextShimmer className="cs-status-text">{label}</TextShimmer>
                ) : (
                  <span className="cs-status-text">{label}</span>
                )}
              </motion.span>
            </AnimatePresence>
          </span>
        </div>

        <div className="cs-actions-slot">
          <AnimatePresence initial={false}>
            {actions === "none" ? null : (
              <motion.div
                key={actions}
                className="cs-actions"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: swapOut }}
                transition={swapIn}
              >
                {actions === "busy" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="cs-foot-button"
                    onClick={() => {
                      if (simulated) {
                        setSim((current) => ({ ...current, phase: "ready", stopped: true }));
                      }
                      onStop?.();
                      focusCode();
                    }}
                  >
                    <Square size={11} strokeWidth={0} fill="currentColor" aria-hidden="true" />
                    Stop
                  </Button>
                ) : null}

                {actions === "review" ? (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="cs-foot-button"
                      onClick={() => rejectAll(true)}
                      aria-keyshortcuts={shortcuts ? "Meta+Backspace Control+Backspace" : undefined}
                    >
                      Reject all
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      className="cs-foot-button cs-accept"
                      data-pressing={pressing === "accept-all" || undefined}
                      onClick={() => acceptAll(true)}
                      aria-keyshortcuts={shortcuts ? "Meta+Enter Control+Enter" : undefined}
                    >
                      Accept all
                      {shortcuts ? (
                        <span className="cs-shortcut" aria-hidden="true">
                          {platform === "mac" ? "⌘" : "Ctrl"}↵
                        </span>
                      ) : null}
                    </Button>
                  </>
                ) : null}

                {actions === "done" || actions === "error" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="cs-foot-button"
                    onClick={() => {
                      if (simulated) restart(true);
                      onRegenerate?.();
                      focusCode();
                    }}
                  >
                    <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
                    {actions === "error" ? "Retry" : "Regenerate"}
                  </Button>
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <p className="cs-sr-only" aria-live="polite" role="status">
        {liveMessage}
      </p>
    </div>
  );
}
