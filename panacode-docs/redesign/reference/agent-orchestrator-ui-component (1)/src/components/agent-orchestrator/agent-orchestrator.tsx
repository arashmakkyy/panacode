import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { motion } from "motion/react";
import { cn } from "../../utils/cn";
import { Connectors, type ConnectorsHandle } from "./connectors";
import { sameGeometry, type Geometry } from "./geometry";
import { PlayIcon, RerunIcon, SparkMark, StatusGlyph, StopIcon } from "./icons";
import { LaneCard, defaultMark } from "./lane";
import { Button, ChunkText, Counter, CopyButton, DeltaText, Elapsed, Segmented, Swap, useReduced } from "./primitives";
import { sampleGoal, samplePlan, sampleLead, sampleWorkers, simulateOrchestration } from "./simulate";
import { buildResult, initialState, laneIndexFor, laneViews, reduce, totals, type State } from "./state";
import type { AgentOrchestratorProps, LaneStatus, OrchestratorEvent } from "./types";

const WIDE_AT = 720;
const STACK_CY = 27;

const fmtSec = (ms: number) => `${(ms / 1000).toFixed(1)} seconds`;
const fmtCost = (v: number) => `$${v.toFixed(4)}`;

export function AgentOrchestrator({
  goal = sampleGoal,
  plan = samplePlan,
  workers = sampleWorkers,
  lead = sampleLead,
  run,
  concurrency,
  defaultConcurrency,
  onConcurrencyChange,
  autoStart = true,
  onComplete,
  className,
}: AgentOrchestratorProps) {
  const reduced = useReduced();
  const uid = useId().replace(/:/g, "");
  const maxConc = Math.min(4, Math.max(1, workers.length));
  const simulated = !run;

  /* ───────── concurrency ───────── */
  const [innerConc, setInnerConc] = useState(Math.min(maxConc, Math.max(1, defaultConcurrency ?? maxConc)));
  const conc = Math.min(maxConc, Math.max(1, concurrency ?? innerConc));
  const concRef = useRef(conc);
  concRef.current = conc;
  const changeConc = useCallback(
    (v: number) => {
      const next = Math.min(maxConc, Math.max(1, v));
      setInnerConc(next);
      onConcurrencyChange?.(next);
    },
    [maxConc, onConcurrencyChange],
  );

  /* ───────── run state (one reducer, mirrored in a ref so the event loop can read it) ───────── */
  const workersRef = useRef(workers);
  workersRef.current = workers;
  const stateRef = useRef<State>(initialState(workers));
  const [, force] = useReducer((n: number) => n + 1, 0);
  const state = stateRef.current;
  const commit = useCallback((next: State) => {
    stateRef.current = next;
    force();
  }, []);

  const [notes, setNotes] = useState<{ id: number; text: string }[]>([]);
  const noteId = useRef(0);
  const announce = useCallback((text: string) => {
    setNotes(n => [...n.slice(-7), { id: ++noteId.current, text }]);
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const connectors = useRef<ConnectorsHandle>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const propsRef = useRef({ goal, plan, run });
  propsRef.current = { goal, plan, run };

  const start = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const id = ++runIdRef.current;
    const alive = () => !ctrl.signal.aborted && id === runIdRef.current;

    commit(reduce(stateRef.current, { kind: "start", now: performance.now(), workers: workersRef.current }));
    setOpen(new Set());
    setNotes([]);
    announce(simulated ? "Run started. This run is a simulation." : "Run started.");

    let firstSummary = true;
    let planned = false;
    let completed = false;

    const apply = (event: OrchestratorEvent) => {
      const prev = stateRef.current;
      const next = reduce(prev, { kind: "event", event, now: performance.now(), workers: workersRef.current });
      commit(next);

      const sid = "subtaskId" in event ? event.subtaskId : undefined;
      const laneOf = sid ? laneIndexFor(next, sid) : -1;
      const lane = laneOf >= 0 ? next.lanes[laneOf] : null;
      const title = lane?.subtask?.title ?? "";
      switch (event.type) {
        case "plan":
          if (!planned) {
            planned = true;
            announce("The lead is writing the plan.");
          }
          break;
        case "dispatch":
          if (lane) {
            connectors.current?.pulse(laneOf, "down");
            announce(`Dispatched ${title} to ${lane.worker.name}.`);
          }
          break;
        case "error":
          if (lane)
            announce(
              `${title} failed: ${event.message}.${event.retryInMs ? ` Retrying in ${Math.round(event.retryInMs / 1000)} seconds.` : ""}`,
            );
          break;
        case "retry":
          if (lane) announce(`Retrying ${title}.`);
          break;
        case "result":
          if (lane) {
            connectors.current?.pulse(laneOf, "up");
            announce(`${title} returned from ${lane.worker.name}.`);
          }
          break;
        case "fail":
          if (lane) announce(`${title} gave up.`);
          break;
        case "summary":
          if (firstSummary) {
            firstSummary = false;
            announce("The lead is writing the summary.");
          }
          break;
        case "done":
          if (!completed && next.phase === "done") {
            completed = true;
            const result = buildResult(next);
            announce(
              `Run complete. ${result.tokens.toLocaleString("en-US")} tokens, ${fmtCost(result.cost)}. Wall time ${fmtSec(result.wallMs)}, ${fmtSec(result.sequentialMs)} in sequence, ${result.speedup.toFixed(1)} times faster.`,
            );
            onCompleteRef.current?.(result);
          }
          break;
      }
    };

    (async () => {
      try {
        const hook = propsRef.current.run ?? simulateOrchestration;
        const iterable = hook({
          goal: propsRef.current.goal,
          plan: propsRef.current.plan,
          workers: workersRef.current,
          concurrency: () => concRef.current,
          signal: ctrl.signal,
        });
        for await (const event of iterable) {
          if (!alive()) break;
          apply(event);
        }
        if (alive() && stateRef.current.phase !== "done") apply({ type: "done" });
      } catch (err) {
        if (alive()) {
          const message = err instanceof Error ? err.message : "The run failed";
          commit(reduce(stateRef.current, { kind: "crash", now: performance.now(), message }));
          announce(`The run failed: ${message}.`);
        }
      }
    })();
  }, [announce, commit, simulated]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    runIdRef.current++;
    commit(reduce(stateRef.current, { kind: "stop", now: performance.now() }));
    announce("Run stopped.");
  }, [announce, commit]);

  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => () => abortRef.current?.abort(), []);

  // keep idle lanes in step with the workers prop
  const workerKey = workers.map(w => w.id).join("|");
  useEffect(() => {
    if (stateRef.current.phase === "idle") commit(initialState(workersRef.current));
  }, [workerKey, commit]);

  /* ───────── auto start when scrolled into view ───────── */
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!autoStart || reduced) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting) && stateRef.current.phase === "idle") {
          io.disconnect();
          startRef.current();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [autoStart, reduced]);

  /* ───────── open transcripts ───────── */
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = useCallback((i: number) => {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  /* ───────── measured geometry ───────── */
  const flowRef = useRef<HTMLDivElement>(null);
  const leadRef = useRef<HTMLElement>(null);
  const leadMarkRef = useRef<HTMLSpanElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const laneEls = useRef<Map<number, HTMLDivElement>>(new Map());
  const [wide, setWide] = useState(false);
  const wideRef = useRef(false);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const geoRef = useRef<Geometry | null>(null);
  const [, setLaneEpoch] = useState(0);

  const registerLane = useCallback((index: number, el: HTMLDivElement | null) => {
    const map = laneEls.current;
    if (el) {
      if (map.get(index) !== el) {
        map.set(index, el);
        setLaneEpoch(n => n + 1);
      }
    } else if (!el) {
      // ref churn on re-render: ignore nulls, lanes are keyed by index and never unmount mid-run
    }
  }, []);

  const laneCount = state.lanes.length;

  const measure = useCallback((sync: boolean) => {
    const flow = flowRef.current;
    const root = rootRef.current;
    const leadEl = leadRef.current;
    const sum = summaryRef.current;
    if (!flow || !root || !leadEl || !sum) return;
    const n = stateRef.current.lanes.length;
    const rootW = root.getBoundingClientRect().width;
    const wideNow = rootW >= WIDE_AT && n <= 4;
    if (wideNow !== wideRef.current) {
      wideRef.current = wideNow;
      if (sync) flushSync(() => setWide(wideNow));
      else setWide(wideNow);
    }
    const mode = wideRef.current ? "wide" : "stack";
    const fr = flow.getBoundingClientRect();
    const lr = leadEl.getBoundingClientRect();
    const sr = sum.getBoundingClientRect();
    const mk = leadMarkRef.current?.getBoundingClientRect();
    const r = (v: number) => Math.round(v * 2) / 2;
    const lanes = [];
    for (let i = 0; i < n; i++) {
      const el = laneEls.current.get(i);
      if (!el) return;
      const b = el.getBoundingClientRect();
      lanes.push({
        x: r(b.left - fr.left + b.width / 2),
        top: r(b.top - fr.top),
        bottom: r(b.bottom - fr.top),
        left: r(b.left - fr.left),
        cy: r(b.top - fr.top + STACK_CY),
      });
    }
    const leadCenter = r(lr.left - fr.left + lr.width / 2);
    const trunk = mk ? r(mk.left - fr.left + mk.width / 2) : r(lr.left - fr.left + 25);
    const g: Geometry = {
      mode,
      w: r(fr.width),
      h: r(fr.height),
      leadX: mode === "wide" ? leadCenter : trunk,
      leadBottom: r(lr.bottom - fr.top),
      sumX: mode === "wide" ? r(sr.left - fr.left + sr.width / 2) : trunk,
      sumTop: r(sr.top - fr.top),
      lanes,
    };
    if (sameGeometry(geoRef.current, g)) return;
    geoRef.current = g;
    if (sync) flushSync(() => setGeometry(g));
    else setGeometry(g);
  }, []);

  useLayoutEffect(() => {
    const flow = flowRef.current;
    const root = rootRef.current;
    if (!flow || !root) return;
    measure(false);
    const ro = new ResizeObserver(() => measure(true));
    ro.observe(root);
    ro.observe(flow);
    if (leadRef.current) ro.observe(leadRef.current);
    if (summaryRef.current) ro.observe(summaryRef.current);
    laneEls.current.forEach((el, i) => {
      if (i < laneCount) ro.observe(el);
    });
    return () => ro.disconnect();
  }, [measure, laneCount, wide]);

  /* ───────── derived view ───────── */
  const views = useMemo(() => laneViews(state, conc), [state, conc]);
  const tot = totals(state);
  const phase = state.phase;
  const running = phase === "planning" || phase === "running" || phase === "summarizing";
  const finished = phase === "done" || phase === "stopped" || phase === "error";
  const returned = state.lanes.filter(l => l.status === "returned" || l.status === "gaveup").length;
  const planCount = state.plan.length;
  const waitingToSend = state.lanes.some(l => l.status === "planned");

  const leadWord =
    phase === "idle"
      ? "Ready"
      : phase === "planning"
        ? "Planning"
        : phase === "running"
          ? waitingToSend
            ? "Dispatching"
            : `Waiting on lanes · ${returned}/${planCount}`
          : phase === "summarizing"
            ? "Writing summary"
            : phase === "done"
              ? "Done"
              : phase === "stopped"
                ? "Stopped"
                : "Failed";
  const leadGlyph: LaneStatus = running ? "running" : phase === "done" ? "returned" : phase === "stopped" ? "stopped" : phase === "error" ? "gaveup" : "planned";

  const summaryText = state.summary.join("");
  const statusKey = views.map(v => v.status).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const connectorLanes = useMemo(() => statusKey.split(",").map(status => ({ status: status as LaneStatus })), [statusKey]);
  const runLabel = running ? "Stop" : finished ? "Run again" : "Run";

  const flowStyle: CSSProperties = { rowGap: wide ? 56 : 36 };

  return (
    <section
      ref={rootRef}
      aria-labelledby={`${uid}-goal`}
      className={cn(
        "@container relative w-full overflow-hidden rounded-[28px] border border-line bg-sunken text-fg shadow-[var(--shadow)]",
        className,
      )}
    >
      {/* header */}
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pb-1 pt-5 @max-[440px]:px-3 @max-[440px]:pt-3">
        <div className="min-w-0 flex-1 basis-64">
          <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium uppercase tracking-[0.08em] text-fg3">
            <span>Orchestrator</span>
            {simulated && (
              <span className="rounded-full border border-line px-1.5 py-px text-[10px] normal-case tracking-normal">Simulated run</span>
            )}
          </div>
          <h2 id={`${uid}-goal`} className="text-balance text-[17px] font-semibold leading-snug tracking-[-0.01em] @max-[440px]:text-[15px]">
            {goal}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="flex items-center gap-2 text-xs text-fg3">
            <span id={`${uid}-par`} className="@max-[440px]:hidden">
              Parallel lanes
            </span>
            <Segmented value={conc} max={maxConc} onChange={changeConc} label="Concurrency limit" idPrefix={uid} />
          </span>
          <Button variant="primary" onClick={running ? stop : start} className="min-w-[92px]">
            <Swap id={runLabel} className="flex items-center">
              <span className="flex items-center gap-1.5">
                {running ? <StopIcon /> : finished ? <RerunIcon /> : <PlayIcon />}
                {runLabel}
              </span>
            </Swap>
          </Button>
        </div>
      </header>

      {/* flow */}
      <div ref={flowRef} className="relative flex flex-col px-5 pb-5 pt-5 @max-[440px]:px-3 @max-[440px]:pb-3" style={flowStyle}>
        <Connectors
          ref={connectors}
          geometry={geometry}
          lanes={connectorLanes}
          reduced={reduced}
          leadActive={phase !== "idle"}
          summaryActive={phase === "summarizing" || phase === "done"}
        />

        {/* lead */}
        <section
          ref={leadRef}
          aria-label="Lead agent and plan"
          className={cn("relative z-10 w-full rounded-2xl border border-line bg-card p-3 shadow-[var(--shadow)]", wide && "mx-auto max-w-2xl")}
        >
          <div className="flex items-center gap-2.5">
            <span ref={leadMarkRef} aria-hidden className="grid size-6 shrink-0 place-items-center rounded-md bg-fg text-card">
              {lead.mark ?? <SparkMark size={14} />}
            </span>
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate text-[13px] font-semibold">{lead.name}</span>
              <span className="text-xs text-fg3">Lead</span>
            </div>
            <span className={cn("flex min-w-0 items-center gap-1.5 text-xs font-medium", running ? "text-fg" : phase === "done" ? "text-ok" : "text-fg3")}>
              <StatusGlyph status={leadGlyph} spin={!reduced} />
              <Swap id={leadWord.replace(/\d/g, "#")}>
                <span className={cn("block truncate tabular-nums", running && "arc-shimmer")} style={running ? ({ "--sh-base": "var(--fg2)", "--sh-hi": "var(--fg)" } as CSSProperties) : undefined}>
                  {leadWord}
                </span>
              </Swap>
            </span>
            <span className="text-xs text-fg3 @max-[440px]:hidden">
              <Elapsed start={state.startedAt} end={state.endedAt} />
            </span>
          </div>

          <section aria-label="Plan" className="mt-2.5 border-t border-line pt-1.5">
            {state.plan.length === 0 ? (
              <p className="py-1.5 text-[13px] text-fg3">
                {phase === "planning" ? (
                  <span className={cn(!reduced && "arc-breathe")}>Splitting the goal into subtasks…</span>
                ) : phase === "stopped" ? (
                  "Stopped before a plan was written."
                ) : (
                  "Run the goal and the lead will split it into subtasks here."
                )}
              </p>
            ) : (
              <ol>
                {state.plan.map(({ subtask, lane }, i) => (
                  <motion.li
                    key={subtask.id}
                    initial={reduced ? false : { height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    transition={{ type: "spring", stiffness: 380, damping: 39, mass: 1 }}
                    style={{ overflow: "hidden", "--c": `var(--s${(lane % 4) + 1})` } as CSSProperties}
                  >
                    <div className="flex items-start gap-2.5 py-1.5 text-[13px] leading-5">
                      <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--c)]" />
                      <p className="min-w-0 flex-1">
                        <span className="mr-1.5 tabular-nums text-fg3">{i + 1}.</span>
                        <span className="font-medium text-fg">{subtask.title}</span>
                        {subtask.instruction && (
                          <span className="text-fg2">
                            {" "}
                            <span aria-hidden className="text-fg3">
                              —
                            </span>{" "}
                            <ChunkText text={subtask.instruction} />
                          </span>
                        )}
                      </p>
                    </div>
                  </motion.li>
                ))}
              </ol>
            )}
          </section>
        </section>

        {/* lanes */}
        <div
          className={cn(wide ? "grid gap-3" : "flex flex-col gap-3 pl-11")}
          style={wide ? { gridTemplateColumns: `repeat(${Math.max(1, laneCount)}, minmax(0, 1fr))` } : undefined}
        >
          {views.map(v => (
            <LaneCard
              key={v.lane.index}
              view={v}
              colorIndex={v.lane.index}
              open={open.has(v.lane.index)}
              onToggle={toggle}
              idPrefix={uid}
              reduced={reduced}
              registerRef={registerLane}
            />
          ))}
        </div>

        {/* summary */}
        <section
          ref={summaryRef}
          aria-label="Summary"
          className={cn("relative z-10 w-full rounded-2xl border border-line bg-card shadow-[var(--shadow)]", wide && "mx-auto max-w-2xl")}
        >
          <div className="flex items-center gap-2.5 px-3 pt-3">
            <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-md bg-fg text-card">
              {lead.mark ?? defaultMark({ id: "lead", name: lead.name }, 14)}
            </span>
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="text-[13px] font-semibold">Summary</span>
              <span className="truncate text-xs text-fg3">{lead.name}</span>
            </div>
            {phase === "done" && summaryText && <CopyButton text={summaryText} />}
          </div>
          <div className="px-3 pb-3 pt-2 text-[13.5px] leading-[1.6]">
            {summaryText ? (
              <p className="text-fg">
                <DeltaText parts={state.summary} />
              </p>
            ) : (
              <p className="text-fg3">
                {phase === "stopped"
                  ? "The run was stopped before the lanes returned."
                  : phase === "error"
                    ? (state.error ?? "The run failed.")
                    : running
                      ? "Waiting for every lane to return, then the lead merges what came back."
                      : "The lead merges what the lanes return into one answer."}
              </p>
            )}
          </div>

          {/* totals */}
          <motion.div
            initial={false}
            animate={{ height: phase === "done" ? "auto" : 0, opacity: phase === "done" ? 1 : 0 }}
            transition={reduced ? { duration: 0 } : { type: "spring", duration: 0.5, bounce: 0 }}
            inert={phase !== "done"}
            className="overflow-hidden"
          >
            <Totals tokens={tot.tokens} cost={tot.cost} wallMs={tot.wallMs} sequentialMs={tot.sequentialMs} speedup={tot.speedup} reduced={reduced} show={phase === "done"} />
          </motion.div>
        </section>
      </div>

      {/* status region */}
      <div role="status" aria-live="polite" className="sr-only">
        {notes.map(n => (
          <p key={n.id}>{n.text}</p>
        ))}
      </div>
    </section>
  );
}

function Totals({
  tokens,
  cost,
  wallMs,
  sequentialMs,
  speedup,
  reduced,
  show,
}: {
  tokens: number;
  cost: number;
  wallMs: number;
  sequentialMs: number;
  speedup: number;
  reduced: boolean;
  show: boolean;
}) {
  const ratio = Math.min(1, wallMs / Math.max(1, sequentialMs));
  const bar = (scale: number, color: string, delay: number) => (
    <span className="relative block h-2 overflow-hidden rounded-full bg-sunken">
      <motion.span
        className="absolute inset-0 origin-left rounded-full"
        style={{ background: color }}
        initial={false}
        animate={{ scaleX: show ? scale : 0 }}
        transition={reduced ? { duration: 0 } : { type: "spring", duration: 0.9, bounce: 0, delay }}
      />
    </span>
  );
  return (
    <div className="border-t border-line px-3 pb-3 pt-3">
      <dl className="grid grid-cols-4 gap-3 @max-[440px]:grid-cols-2">
        <Stat label="Tokens">
          <Counter value={show ? tokens : 0} />
        </Stat>
        <Stat label="Cost">
          <Counter value={show ? cost : 0} format="cost" />
        </Stat>
        <Stat label="Wall time">
          <Counter value={show ? wallMs : 0} format="sec" />
        </Stat>
        <Stat label="Speedup">
          <span className="text-ok">
            <Counter value={show ? speedup : 1} format="x" />
          </span>
        </Stat>
      </dl>
      <div className="mt-3.5 space-y-2" aria-label="Wall time compared with running every subtask in sequence" role="group">
        <div className="grid grid-cols-[84px_1fr_52px] items-center gap-2.5 text-xs @max-[440px]:grid-cols-[68px_1fr_48px]">
          <span className="text-fg2">In parallel</span>
          {bar(ratio, "var(--ok)", 0.15)}
          <span className="text-right tabular-nums text-fg">{(wallMs / 1000).toFixed(1)}s</span>
        </div>
        <div className="grid grid-cols-[84px_1fr_52px] items-center gap-2.5 text-xs @max-[440px]:grid-cols-[68px_1fr_48px]">
          <span className="text-fg2">In sequence</span>
          {bar(1, "var(--fg3)", 0)}
          <span className="text-right tabular-nums text-fg3">{(sequentialMs / 1000).toFixed(1)}s</span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-fg3">{label}</dt>
      <dd className="mt-0.5 truncate text-[15px] font-semibold tabular-nums tracking-[-0.01em]">{children}</dd>
    </div>
  );
}
