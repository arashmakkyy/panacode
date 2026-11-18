import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCheck, ChevronRight, ShieldCheck } from "lucide-react";
import { AnimatedCounter } from "../../animated-counter";
import { Button } from "../../button";
import { Kbd } from "../../kbd";
import { T } from "../../motion";
import { NorthwindMark } from "./marks";
import {
  AgentMark,
  FocusCard,
  IDLE,
  ResolvedLog,
  RiskLabel,
  RulesPopover,
  Swap,
  ToolMark,
  AutoHeight,
  exitQuick,
  heightSpring,
  isOpen,
  type CardState,
} from "./parts";
import {
  DEMO_NOW,
  SAMPLE_REQUESTS,
  SAMPLE_RESOLVED,
  SAMPLE_RULES,
  type ApprovalDecision,
  type ApprovalRequest,
  type ApprovalRule,
  type ResolvedEntry,
  type RuleChange,
} from "./data";
import styles from "./agent-approvals.module.css";

export type {
  ApprovalAgent,
  ApprovalArgument,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalRule,
  ApprovalTool,
  ResolvedEntry,
  RuleChange,
} from "./data";

export interface AgentApprovalsProps {
  /** Pending tool calls in queue order. Leave unset for the simulated demo. */
  requests?: ApprovalRequest[];
  /** Always-allow rules that already skip the ask. */
  rules?: ApprovalRule[];
  /** Earlier decisions for the log, newest first. */
  resolved?: ResolvedEntry[];
  reviewer?: string;
  workspace?: string;
  workspaceMark?: ReactNode;
  title?: string;
  onDecision?: (decision: ApprovalDecision) => void | Promise<unknown>;
  onRuleChange?: (change: RuleChange) => void;
  className?: string;
}

type Outcome = "approved" | "denied";
type Point = { x: number; y: number };
type Flight = { id: string; rule: ApprovalRule; from: Point; to: Point };
type ShortcutEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  target: EventTarget | null;
  preventDefault: () => void;
};

const flightEase = [...T.ease.inOut] as [number, number, number, number];

/* One shared 15 second clock for the relative times. */
const subscribeClock = (onTick: () => void) => {
  const id = window.setInterval(onTick, 15e3);
  return () => window.clearInterval(id);
};
const readClock = () => 15e3 * Math.floor(Date.now() / 15e3);
const readServerClock = () => null;

function useClock(demo: boolean) {
  const tick = useSyncExternalStore<number | null>(subscribeClock, readClock, readServerClock);
  const [base] = useState(() => ({ wall: Date.now(), demo: Date.parse(DEMO_NOW) }));
  const now = tick === null ? null : demo ? base.demo + Math.max(0, tick - base.wall) : tick;
  const stamp = useCallback(
    () => new Date(demo ? base.demo + (Date.now() - base.wall) : Date.now()).toISOString(),
    [demo, base],
  );
  return { now, stamp };
}

export function AgentApprovals({
  requests,
  rules: initialRules,
  resolved: initialResolved,
  reviewer = "Emma Collins",
  workspace = "Northwind",
  workspaceMark = workspace === "Northwind" ? <NorthwindMark aria-hidden="true" /> : undefined,
  title = "Approvals",
  onDecision,
  onRuleChange,
  className,
}: AgentApprovalsProps) {
  const demo = requests === undefined;
  const reduced = !!useReducedMotion();
  const uid = useId();
  const { now, stamp } = useClock(demo);

  const [queue, setQueue] = useState<ApprovalRequest[]>(() => requests ?? SAMPLE_REQUESTS);
  const [focusId, setFocusId] = useState<string | null>(() => (requests ?? SAMPLE_REQUESTS)[0]?.id ?? null);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [rules, setRules] = useState<ApprovalRule[]>(() => initialRules ?? (demo ? SAMPLE_RULES : []));
  const [resolved, setResolved] = useState<ResolvedEntry[]>(() => initialResolved ?? (demo ? SAMPLE_RESOLVED : []));
  const [mode, setMode] = useState<"swap" | "advance">("swap");
  const [flight, setFlight] = useState<Flight | null>(null);
  const [bump, setBump] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [pressedKey, setPressedKey] = useState<string | null>(null);

  /* Ids added to a later requests array join the end of the queue. */
  const [seenRequests, setSeenRequests] = useState(requests);
  if (requests !== seenRequests) {
    setSeenRequests(requests);
    if (requests) {
      const done = new Set(resolved.map((entry) => entry.id));
      const queued = new Set(queue.map((request) => request.id));
      const fresh = requests.filter((request) => !queued.has(request.id) && !done.has(request.id));
      if (fresh.length) {
        setQueue([...queue, ...fresh]);
        if (!focusId) setFocusId(fresh[0].id);
      }
    }
  }

  const rootRef = useRef<HTMLElement>(null);
  const focusAreaRef = useRef<HTMLDivElement>(null);
  const allowRef = useRef<HTMLSpanElement>(null);
  const rulesButtonRef = useRef<HTMLButtonElement>(null);

  /* Async callbacks read the latest state from here instead of re-subscribing. */
  const latest = useRef({ queue, cards, edits, focusId, onDecision, onRuleChange });
  useLayoutEffect(() => {
    latest.current = { queue, cards, edits, focusId, onDecision, onRuleChange };
  });

  const timers = useRef(new Set<number>());
  const busy = useRef(new Set<string>());
  const failedOnce = useRef(false);
  const engaged = useRef(false);
  const flightDone = useRef<(() => void) | null>(null);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(window.clearTimeout);
      pending.clear();
    };
  }, []);

  const later = useCallback((run: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      run();
    }, ms);
    timers.current.add(id);
  }, []);

  /* Repeating the same message still gets announced. */
  const announce = useCallback((message: string) => {
    setAnnouncement((current) => (current === message ? `${message} ` : message));
  }, []);

  const setCard = useCallback((id: string, state: CardState) => {
    setCards((current) => ({ ...current, [id]: state }));
  }, []);

  /* When the pressed button leaves, focus moves to the region so shortcuts keep working. */
  const refocus = useCallback(
    () =>
      later(() => {
        const active = document.activeElement;
        if ((!active || active === document.body) && engaged.current) {
          focusAreaRef.current?.focus({ preventScroll: true });
        }
      }, 150),
    [later],
  );

  const collect = (request: ApprovalRequest) => {
    const changed = latest.current.edits[request.id] ?? {};
    return {
      args: Object.fromEntries(request.args.map((arg) => [arg.key, changed[arg.key] ?? arg.value])),
      edited: request.args.some((arg) => changed[arg.key] !== undefined && changed[arg.key] !== arg.value),
    };
  };

  /* Sends a decision. Without onDecision, delivery is simulated. */
  const deliver = useCallback(
    (decision: ApprovalDecision, fail: boolean): Promise<void> => {
      const handler = latest.current.onDecision;
      if (handler) {
        try {
          return Promise.resolve(handler(decision)).then(() => undefined);
        } catch (error) {
          return Promise.reject(error);
        }
      }
      return new Promise<void>((resolve, reject) =>
        later(() => (fail ? reject(new Error("timeout")) : resolve()), decision.outcome === "denied" ? 280 : 460),
      );
    },
    [later],
  );

  /* Moves a decided request into the log and slides the next one up. */
  const settle = useCallback(
    (request: ApprovalRequest, entry: Pick<ResolvedEntry, "outcome" | "edited" | "decidedBy" | "decidedAt">) => {
      const { queue: current, cards: states, focusId: focused } = latest.current;
      const index = current.findIndex((item) => item.id === request.id);
      if (index < 0) return;
      busy.current.delete(request.id);
      const rest = current.filter((item) => item.id !== request.id);
      if (focused === request.id) {
        const next =
          [...rest.slice(index), ...rest.slice(0, index)].find(
            (item) => isOpen(states[item.id]) && !busy.current.has(item.id),
          ) ?? null;
        setMode("advance");
        setFocusId(next?.id ?? null);
      }
      setQueue((items) => items.filter((item) => item.id !== request.id));
      setResolved((log) => [
        { id: request.id, agentName: request.agent.name, tool: request.tool, summary: request.summary, ...entry },
        ...log,
      ]);
      refocus();
    },
    [refocus],
  );

  const decide = useCallback(
    (id: string, outcome: Outcome) => {
      const request = latest.current.queue.find((item) => item.id === id);
      if (!request || !isOpen(latest.current.cards[id]) || busy.current.has(id)) return;
      busy.current.add(id);
      const { args, edited } = collect(request);
      const decision: ApprovalDecision = { requestId: id, outcome, args, edited, decidedBy: reviewer, decidedAt: stamp() };
      /* The demo shows the error state once: the first approval of the database write does not get through. */
      const simulateFailure =
        demo && !latest.current.onDecision && outcome === "approved" && id === "req-sql-plans" && !failedOnce.current;
      if (simulateFailure) failedOnce.current = true;
      setCard(id, { phase: "sending", outcome });
      refocus();
      deliver(decision, simulateFailure).then(
        () => {
          setCard(id, { phase: "done", outcome, edited });
          announce(
            `${outcome === "approved" ? (edited ? "Approved with your edits" : "Approved") : "Denied"}: ${request.agent.name}, ${request.summary}.${demo ? " Simulated, nothing ran." : ""}`,
          );
          later(
            () => settle(request, { outcome, edited, decidedBy: reviewer, decidedAt: decision.decidedAt }),
            620,
          );
        },
        (error: unknown) => {
          const message =
            demo && !latest.current.onDecision
              ? `${request.agent.name} did not answer, so nothing ran. This failure is simulated.`
              : error instanceof Error && error.message
                ? error.message
                : `${request.agent.name} did not get your decision. Nothing ran.`;
          busy.current.delete(id);
          setCard(id, { phase: "error", outcome, message });
          announce(`Not sent. ${message} Retry or deny.`);
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [announce, deliver, demo, refocus, later, reviewer, setCard, settle, stamp],
  );

  /* Always allow approves the request in focus and creates a rule that covers matching requests. */
  const alwaysAllow = useCallback(
    (scope: "agent" | "workspace") => {
      const focused = latest.current.focusId;
      const request = latest.current.queue.find((item) => item.id === focused);
      if (!focused || !request || !isOpen(latest.current.cards[focused]) || busy.current.has(focused)) return;
      busy.current.add(focused);
      const { args, edited } = collect(request);
      const decidedAt = stamp();
      const rule: ApprovalRule = {
        id: `rule-${request.tool.id}-${scope === "agent" ? request.agent.id : "all"}-${Date.now().toString(36)}`,
        tool: request.tool,
        scope,
        agent: scope === "agent" ? { id: request.agent.id, name: request.agent.name } : undefined,
        createdBy: reviewer,
        createdAt: decidedAt,
      };
      setCard(focused, { phase: "done", outcome: "approved", rule, edited });
      refocus();

      const apply = () => {
        flightDone.current = null;
        setFlight(null);
        setRules((list) => [rule, ...list]);
        setBump((count) => count + 1);
        latest.current.onRuleChange?.({ type: "added", rule });
        const { queue: current, cards: states } = latest.current;
        const covered = current.filter(
          (item) =>
            item.id !== focused &&
            rule.tool.id === item.tool.id &&
            (rule.scope === "workspace" || rule.agent?.id === item.agent.id) &&
            isOpen(states[item.id]) &&
            !busy.current.has(item.id),
        );
        covered.forEach((item) => busy.current.add(item.id));
        const who = scope === "agent" ? request.agent.name : `Any agent in ${workspace}`;
        announce(
          `Rule added: ${who} can ${rule.tool.action.toLowerCase()} without asking.${
            covered.length ? ` It allowed ${covered.length} waiting ${covered.length === 1 ? "request" : "requests"}.` : ""
          }`,
        );
        covered.forEach((item, index) => {
          setCard(item.id, { phase: "auto", outcome: "allowed", rule });
          const values = collect(item);
          const at = stamp();
          deliver(
            {
              requestId: item.id,
              outcome: "allowed",
              args: values.args,
              edited: values.edited,
              ruleId: rule.id,
              decidedBy: "Rule",
              decidedAt: at,
            },
            false,
          ).then(
            () => later(() => settle(item, { outcome: "allowed", decidedBy: "Rule", decidedAt: at }), 1100 + 80 * index),
            () => {
              busy.current.delete(item.id);
              setCard(item.id, IDLE);
              announce(`The rule matched ${item.summary}, but ${item.agent.name} did not get the approval. It is still waiting.`);
            },
          );
        });
      };

      /* A small rule chip flies from the menu into the Rules button, then the rule lands. */
      const rootBox = rootRef.current?.getBoundingClientRect();
      const centerOf = (node: Element | null): Point | null => {
        const box = node?.getBoundingClientRect();
        return box && rootBox
          ? { x: box.left - rootBox.left + box.width / 2, y: box.top - rootBox.top + box.height / 2 }
          : null;
      };
      const from = centerOf(allowRef.current);
      const to = centerOf(rulesButtonRef.current);
      if (!reduced && from && to) {
        flightDone.current = apply;
        setFlight({ id: rule.id, rule, from, to });
      } else {
        apply();
      }

      const started = Date.now();
      deliver({ requestId: focused, outcome: "approved", args, edited, ruleId: rule.id, decidedBy: reviewer, decidedAt }, false).then(
        () =>
          later(
            () => settle(request, { outcome: "approved", edited, decidedBy: reviewer, decidedAt }),
            Math.max(620, 920 - (Date.now() - started)),
          ),
        () => {
          busy.current.delete(focused);
          setCard(focused, {
            phase: "error",
            outcome: "approved",
            message: `The rule is saved, but ${request.agent.name} did not get this approval. Nothing ran.`,
          });
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [announce, deliver, refocus, later, reduced, reviewer, setCard, settle, stamp, workspace],
  );

  const removeRule = useCallback(
    (rule: ApprovalRule) => {
      setRules((list) => list.filter((item) => item.id !== rule.id));
      latest.current.onRuleChange?.({ type: "removed", rule });
      const who = rule.scope === "agent" ? (rule.agent?.name ?? "This agent") : `Every agent in ${workspace}`;
      announce(`Rule removed. ${who} will ask before ${rule.tool.action.toLowerCase()} again.`);
    },
    [announce, workspace],
  );

  const editArg = useCallback(
    (key: string, value: string) => {
      const focused = latest.current.focusId;
      if (!focused) return;
      setEdits((current) => ({ ...current, [focused]: { ...current[focused], [key]: value } }));
      const arg = latest.current.queue.find((item) => item.id === focused)?.args.find((item) => item.key === key);
      if (arg) announce(`${arg.label} changed to ${value}. Approve to send the edited value.`);
    },
    [announce],
  );

  const restoreArg = useCallback(
    (key: string) => {
      const focused = latest.current.focusId;
      if (!focused) return;
      setEdits((current) => {
        const next = { ...current[focused] };
        delete next[key];
        return { ...current, [focused]: next };
      });
      const arg = latest.current.queue.find((item) => item.id === focused)?.args.find((item) => item.key === key);
      if (arg) announce(`${arg.label} restored to ${arg.value}.`);
    },
    [announce],
  );

  /* Brings a waiting request into focus with one crossfade. */
  const focusRequest = useCallback(
    (id: string) => {
      const { focusId: focused, cards: states } = latest.current;
      if (id === focused || (focused && !isOpen(states[focused])) || !isOpen(states[id]) || busy.current.has(id)) return;
      setMode("swap");
      setFocusId(id);
      refocus();
    },
    [refocus],
  );

  const flashKey = useCallback(
    (key: string) => {
      setPressedKey(key);
      later(() => setPressedKey((current) => (current === key ? null : current)), 160);
    },
    [later],
  );

  const reset = () => {
    timers.current.forEach(window.clearTimeout);
    timers.current.clear();
    busy.current.clear();
    failedOnce.current = false;
    flightDone.current = null;
    setFlight(null);
    setQueue(SAMPLE_REQUESTS);
    setCards({});
    setEdits({});
    setRules(SAMPLE_RULES);
    setResolved(SAMPLE_RESOLVED);
    setMode("advance");
    setFocusId(SAMPLE_REQUESTS[0]?.id ?? null);
    announce("Sample requests restored.");
    refocus();
  };

  /* Shortcuts answer anywhere in the card but stay quiet in fields, the menu and the popover. */
  const handleShortcut = (event: ShortcutEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, select, [contenteditable='true'], [role='menu'], [role='dialog']")) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const focused = latest.current.focusId;
    if (key === "j" || key === "k") {
      const { queue: current, cards: states } = latest.current;
      const open = current.filter((item) => item.id === focused || (isOpen(states[item.id]) && !busy.current.has(item.id)));
      const index = open.findIndex((item) => item.id === focused);
      const next = open[Math.max(0, Math.min(open.length - 1, index + (key === "j" ? 1 : -1)))];
      if (next) focusRequest(next.id);
    } else if (key === "a" || key === "d") {
      if (!focused) return;
      decide(focused, key === "a" ? "approved" : "denied");
    } else {
      if (key !== "Enter" || !focused || target?.closest("button, a, [role='button']")) return;
      decide(focused, "approved");
    }
    event.preventDefault();
    flashKey(key === "Enter" ? "enter" : key);
  };
  const shortcutRef = useRef(handleShortcut);
  useLayoutEffect(() => {
    shortcutRef.current = handleShortcut;
  });

  /* After a click in the card leaves focus on the page, shortcuts keep answering. */
  useEffect(() => {
    const track = (event: Event) => {
      engaged.current = !!rootRef.current?.contains(event.target as Node);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) engaged.current = true;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (engaged.current && (!document.activeElement || document.activeElement === document.body)) {
        shortcutRef.current(event);
      }
    };
    window.addEventListener("pointerdown", track, true);
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", track, true);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const focused = queue.find((item) => item.id === focusId) ?? null;
  const waiting = queue.filter((item) => item.id !== focusId);
  const pending = queue.filter((item) => {
    const phase = cards[item.id]?.phase;
    return phase !== "done" && phase !== "auto";
  }).length;
  const logId = `${uid}-log`;
  const advancing = mode === "advance" && !reduced;
  const rowMotion = {
    initial: reduced ? { opacity: 0 } : { opacity: 0, height: 0 },
    animate: { opacity: 1, height: "auto" },
    exit: reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0 },
    transition: reduced ? { duration: 0 } : { height: heightSpring, opacity: { duration: 0.16 } },
  };

  return (
    <section
      ref={rootRef}
      className={[styles.root, className].filter(Boolean).join(" ")}
      aria-labelledby={`${uid}-title`}
      onKeyDown={handleShortcut}
    >
      <header className={styles.header}>
        <h2 id={`${uid}-title`} className={styles.title}>
          {title}
        </h2>
        <span className={styles.count}>
          <AnimatedCounter value={pending} /> pending
        </span>
        <RulesPopover
          ref={rulesButtonRef}
          rules={rules}
          workspace={workspace}
          reduced={reduced}
          bump={bump}
          open={rulesOpen}
          onOpenChange={setRulesOpen}
          onRemove={removeRule}
        />
      </header>

      <div
        ref={focusAreaRef}
        className={styles.focusArea}
        tabIndex={-1}
        role="region"
        aria-label="Request in focus"
        aria-keyshortcuts="Enter a d j k"
      >
        <AutoHeight reduced={reduced} innerClassName={styles.focusStack}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={focused?.id ?? "empty"}
              className={styles.focusSlide}
              initial={{ opacity: 0, y: reduced ? 0 : advancing ? 14 : 3 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: reduced
                  ? { duration: 0 }
                  : {
                      opacity: { duration: 0.2, ease: T.ease.enter },
                      y: advancing ? heightSpring : { duration: 0.2, ease: T.ease.enter },
                    },
              }}
              exit={{
                opacity: 0,
                y: reduced || !advancing ? 0 : -6,
                transition: reduced ? { duration: 0 } : exitQuick,
              }}
            >
              {focused ? (
                <FocusCard
                  request={focused}
                  state={cards[focused.id] ?? IDLE}
                  edits={edits[focused.id] ?? {}}
                  now={now}
                  reduced={reduced}
                  workspace={workspace}
                  workspaceMark={workspaceMark}
                  demo={demo}
                  allowRef={allowRef}
                  onEdit={editArg}
                  onRestore={restoreArg}
                  onDecide={(outcome) => decide(focused.id, outcome)}
                  onAlwaysAllow={alwaysAllow}
                />
              ) : (
                <div className={styles.empty}>
                  <CheckCheck className={styles.emptyIcon} size={20} strokeWidth={1.75} aria-hidden="true" />
                  <p className={styles.emptyTitle}>All caught up</p>
                  <p className={styles.emptyText}>Agents ask here when a tool call needs a person. Rules skip the ask.</p>
                  {demo && (
                    <Button variant="secondary" size="sm" onClick={reset}>
                      Restore sample requests
                    </Button>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </AutoHeight>
      </div>

      <ul className={styles.queue} aria-label="Waiting requests">
        <AnimatePresence initial={false}>
          {waiting.map((request) => {
            const auto = cards[request.id]?.phase === "auto";
            return (
              <motion.li key={request.id} className={styles.queueItem} {...rowMotion}>
                <button
                  type="button"
                  className={styles.row}
                  data-auto={auto || undefined}
                  aria-disabled={auto || undefined}
                  onClick={() => focusRequest(request.id)}
                  aria-label={`${request.agent.name}: ${request.summary}. ${auto ? "Allowed by your new rule" : `${request.risk} risk`}`}
                >
                  <span className={styles.rowMarks} aria-hidden="true">
                    <AgentMark agent={request.agent} className={styles.rowMark} />
                    <ToolMark tool={request.tool} className={styles.rowMark} />
                  </span>
                  <span className={styles.rowText}>
                    <span className={styles.rowSummary}>{request.summary}</span>
                    <span className={styles.rowAgent}>{request.agent.name}</span>
                  </span>
                  <Swap id={auto ? "auto" : "risk"} reduced={reduced} className={styles.rowStatus}>
                    {auto ? (
                      <span className={styles.allowed}>
                        <ShieldCheck size={15} strokeWidth={1.75} aria-hidden="true" />
                        <span>
                          Allowed<span className={styles.wideOnly}> by rule</span>
                        </span>
                      </span>
                    ) : (
                      <RiskLabel risk={request.risk} />
                    )}
                  </Swap>
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.logToggle}
          aria-expanded={logOpen}
          aria-controls={logId}
          onClick={() => setLogOpen((open) => !open)}
        >
          <ChevronRight className={styles.chevron} size={16} strokeWidth={1.75} aria-hidden="true" />
          Resolved
          <span className={styles.dot} aria-hidden="true">
            ·
          </span>
          <AnimatedCounter value={resolved.length} />
        </button>
        <span className={styles.hints} aria-hidden="true">
          <span className={styles.hint}>
            <Kbd keys="j" size="sm" pressed={pressedKey === "j"} />
            <Kbd keys="k" size="sm" pressed={pressedKey === "k"} />
            Move
          </span>
          <span className={styles.hint}>
            <Kbd keys="a" size="sm" pressed={pressedKey === "a" || pressedKey === "enter"} />
            Approve
          </span>
          <span className={styles.hint}>
            <Kbd keys="d" size="sm" pressed={pressedKey === "d"} />
            Deny
          </span>
        </span>
      </div>

      <AnimatePresence initial={false}>
        {logOpen && (
          <motion.div
            key="log"
            className={styles.logWrap}
            initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0 }}
            transition={reduced ? { duration: 0 } : { height: heightSpring, opacity: { duration: 0.16 } }}
          >
            <ResolvedLog id={logId} entries={resolved} reduced={reduced} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {flight && (
          <motion.span
            key={flight.id}
            className={styles.flight}
            aria-hidden="true"
            initial={{ x: flight.from.x, y: flight.from.y, opacity: 0 }}
            animate={{ x: flight.to.x, y: flight.to.y, opacity: [0, 1, 1, 0] }}
            exit={{ opacity: 0, transition: { duration: 0 } }}
            transition={{
              x: { duration: 0.56, ease: flightEase },
              y: { duration: 0.56, ease: [0.3, 0, 0.2, 1] },
              opacity: { duration: 0.56, times: [0, 0.16, 0.8, 1], ease: "linear" },
            }}
            onAnimationComplete={() => flightDone.current?.()}
          >
            <span className={styles.chip}>
              <ToolMark tool={flight.rule.tool} className={styles.chipMark} />
              {flight.rule.tool.action}
            </span>
          </motion.span>
        )}
      </AnimatePresence>

      <p className={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}

export default AgentApprovals;
