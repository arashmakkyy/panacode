import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Bot,
  Check,
  CircleAlert,
  Pencil,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  User,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { AnimatedCounter } from "../../animated-counter";
import { Button } from "../../button";
import { DropdownMenu } from "../../dropdown-menu";
import { Kbd } from "../../kbd";
import { Popover, PopoverContent, PopoverTrigger } from "../../popover";
import { TextShimmer } from "../../text-shimmer";
import { T } from "../../motion";
import { BRAND_MARKS, ClaudeMark, GeminiMark, OpenAIMark } from "./marks";
import type {
  ApprovalAgent,
  ApprovalArgument,
  ApprovalRequest,
  ApprovalRule,
  ApprovalTool,
  ResolvedEntry,
  ResolvedOutcome,
  Risk,
} from "./data";
/* Imported last so the block's overrides follow the shared component styles. */
import styles from "./agent-approvals.module.css";

/* ───────────────────────── Shared motion ───────────────────────── */

/** Critically damped: the card's height follows without any bounce. */
export const heightSpring = { type: "spring", visualDuration: 0.3, bounce: 0 } as const;
export const enterFast = { duration: T.duration.fast, ease: T.ease.enter };
export const exitQuick = { duration: 0.1, ease: T.ease.standard };

export const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

export interface CardState {
  phase: "idle" | "sending" | "done" | "error" | "auto";
  outcome?: ResolvedOutcome;
  edited?: boolean;
  rule?: ApprovalRule;
  message?: string;
}

export const IDLE: CardState = { phase: "idle" };
export const isOpen = (state?: CardState) => !state || state.phase === "idle" || state.phase === "error";

/* ───────────────────────── Time ───────────────────────── */

const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

export function clockTime(iso: string) {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? "" : timeFormat.format(time);
}

function relativeTime(iso: string, now: number | null) {
  const time = Date.parse(iso);
  if (now === null || Number.isNaN(time)) return clockTime(iso);
  const minutes = Math.max(0, Math.round((now - time) / 60000));
  return minutes < 1 ? "Just now" : minutes < 60 ? `${minutes} min ago` : clockTime(iso);
}

/* ───────────────────────── Marks ───────────────────────── */

export function ToolMark({ tool, className }: { tool: ApprovalTool; className?: string }) {
  const Brand = tool.brand ? BRAND_MARKS[tool.brand] : undefined;
  return Brand ? (
    <Brand className={cx(styles.mark, className)} data-brand={tool.brand} aria-hidden />
  ) : (
    <Wrench className={cx(styles.mark, className)} strokeWidth={1.75} aria-hidden="true" />
  );
}

export function AgentMark({ agent, className }: { agent: ApprovalAgent; className?: string }) {
  const props = { className: cx(styles.mark, className), "aria-hidden": true as const };
  if (agent.provider === "anthropic") return <ClaudeMark {...props} data-brand="claude" />;
  if (agent.provider === "openai") return <OpenAIMark {...props} />;
  if (agent.provider === "google") return <GeminiMark {...props} />;
  return <Bot {...props} strokeWidth={1.75} />;
}

/* ───────────────────────── Small pieces ───────────────────────── */

const RISK_LABEL: Record<Risk, string> = { low: "Low", medium: "Medium", high: "High" };
const RISK_ICON = { low: ShieldCheck, medium: ShieldAlert, high: ShieldX };

export function RiskLabel({ risk, long = false }: { risk: Risk; long?: boolean }) {
  const Icon = RISK_ICON[risk];
  return (
    <span className={styles.risk} data-risk={risk}>
      <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
      <span>
        {RISK_LABEL[risk]}
        <span className={long ? styles.riskWord : styles.srOnly}> risk</span>
      </span>
    </span>
  );
}

/** Backticks in a title set code in the mono face. */
function CallTitle({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, index) =>
        index % 2 ? (
          <code key={index} className={styles.code}>
            {part}
          </code>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

/** One crossfade between two states that share a grid cell. */
export function Swap({
  id,
  children,
  reduced,
  className,
}: {
  id: string;
  children: ReactNode;
  reduced: boolean;
  className?: string;
}) {
  return (
    <span className={cx(styles.swap, className)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={id}
          className={styles.swapItem}
          initial={{ opacity: 0, y: reduced ? 0 : 2 }}
          animate={{ opacity: 1, y: 0, transition: reduced ? { duration: 0 } : enterFast }}
          exit={{ opacity: 0, transition: reduced ? { duration: 0 } : exitQuick }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Measures its content with one ResizeObserver and springs its height to match. */
export function AutoHeight({
  children,
  reduced,
  className,
  innerClassName,
}: {
  children: ReactNode;
  reduced: boolean;
  className?: string;
  innerClassName?: string;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");

  useLayoutEffect(() => {
    const node = innerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      className={cx(styles.autoHeight, className)}
      initial={false}
      animate={{ height }}
      transition={reduced ? { duration: 0 } : heightSpring}
    >
      <div ref={innerRef} className={cx(styles.autoHeightInner, innerClassName)}>
        {children}
      </div>
    </motion.div>
  );
}

/* ───────────────────────── Arguments ───────────────────────── */

function ArgRow({
  arg,
  value,
  edited,
  disabled,
  onChange,
  onRestore,
}: {
  arg: ApprovalArgument;
  value: string;
  edited: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onRestore: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const valueRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const id = useId();
  const editable = arg.editable !== false;

  useEffect(() => {
    if (editing) {
      fieldRef.current?.focus();
      fieldRef.current?.select();
      return;
    }
    if (returnFocus.current) {
      returnFocus.current = false;
      valueRef.current?.focus();
    }
  }, [editing]);

  const finish = (save: boolean, refocus: boolean) => {
    const next = draft.trim();
    if (save && next && next !== value) onChange(next);
    returnFocus.current = refocus;
    setEditing(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(false, true);
    } else if (event.key === "Enter" && (!arg.multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      finish(true, true);
    }
  };

  const valueClass = cx(styles.argValue, arg.mono && styles.mono);
  const hintId = `${id}-hint`;

  return (
    <div className={styles.argRow} data-edited={edited || undefined}>
      <dt className={styles.argKey}>
        {editing ? <label htmlFor={id}>{arg.label}</label> : arg.label}
        {edited && <span className={styles.srOnly}>, edited</span>}
      </dt>
      <dd className={styles.argCell}>
        {!editable || disabled ? (
          <span className={valueClass} data-static={!editable || undefined}>
            {value}
          </span>
        ) : editing ? (
          arg.multiline ? (
            <textarea
              ref={fieldRef as RefObject<HTMLTextAreaElement>}
              id={id}
              className={cx(valueClass, styles.field)}
              value={draft}
              rows={2}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              onBlur={() => finish(true, false)}
              aria-describedby={hintId}
              spellCheck={false}
            />
          ) : (
            <input
              ref={fieldRef as RefObject<HTMLInputElement>}
              id={id}
              className={cx(valueClass, styles.field)}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              onBlur={() => finish(true, false)}
              aria-describedby={hintId}
              spellCheck={false}
              autoComplete="off"
            />
          )
        ) : (
          <button
            ref={valueRef}
            type="button"
            className={cx(valueClass, styles.valueButton)}
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
            aria-label={`${arg.label}: ${value}. Edit`}
          >
            <span className={styles.valueText}>{value}</span>
            <Pencil className={styles.editIcon} size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
        {editing && (
          <span id={hintId} className={styles.srOnly}>
            {arg.multiline ? "Command Enter saves, Escape cancels" : "Enter saves, Escape cancels"}
          </span>
        )}
      </dd>
      {edited && !editing && !disabled && (
        <button
          type="button"
          className={styles.restore}
          onClick={onRestore}
          aria-label={`Restore ${arg.label} to the agent's value`}
          title="Restore the agent's value"
        >
          <RotateCcw size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/* ───────────────────────── Rules popover ───────────────────────── */

const listMotion = (reduced: boolean) => ({
  initial: reduced ? { opacity: 0 } : { opacity: 0, height: 0 },
  animate: { opacity: 1, height: "auto" },
  transition: reduced ? { duration: 0 } : { height: heightSpring, opacity: { duration: 0.16 } },
});

export const RulesPopover = forwardRef<
  HTMLButtonElement,
  {
    rules: ApprovalRule[];
    workspace: string;
    reduced: boolean;
    bump: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRemove: (rule: ApprovalRule) => void;
  }
>(function RulesPopover({ rules, workspace, reduced, bump, open, onOpenChange, onRemove }, ref) {
  const listRef = useRef<HTMLUListElement>(null);

  const remove = (rule: ApprovalRule, index: number) => {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-remove]") ?? []);
    const hadFocus = buttons[index] === document.activeElement;
    onRemove(rule);
    if (!hadFocus) return;
    const next = buttons[index + 1] ?? buttons[index - 1];
    if (next) next.focus();
    else listRef.current?.closest<HTMLElement>("[data-rules-panel]")?.focus();
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger ref={ref} className={styles.rulesButton} aria-label={`Rules, ${rules.length}`}>
        {bump > 0 && (
          <span key={bump} className={styles.rulesFlash} data-reduced={reduced || undefined} aria-hidden="true" />
        )}
        <span className={styles.rulesLabel} aria-hidden="true">
          Rules<span className={styles.dot}>·</span>
          <AnimatedCounter value={rules.length} />
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={styles.rulesPanel}
        data-rules-panel=""
        tabIndex={-1}
        aria-label="Always allow rules"
      >
        <p className={styles.panelTitle}>Always allowed</p>
        <AutoHeight reduced={reduced}>
          {rules.length === 0 && (
            <p className={styles.panelEmpty}>No rules yet. Choose Always allow on a request to skip the ask next time.</p>
          )}
          <ul ref={listRef} className={styles.ruleList}>
            <AnimatePresence initial={false}>
              {rules.map((rule, index) => (
                <motion.li
                  key={rule.id}
                  className={styles.ruleItem}
                  {...listMotion(reduced)}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                >
                  <div className={styles.rule}>
                    <ToolMark tool={rule.tool} className={styles.ruleMark} />
                    <span className={styles.ruleText}>
                      <span className={styles.ruleAction}>{rule.tool.action}</span>
                      <span className={styles.ruleScope} title={rule.createdBy ? `Added by ${rule.createdBy}` : undefined}>
                        {rule.scope === "agent" ? `${rule.agent?.name ?? "One agent"} only` : `Any agent in ${workspace}`}
                      </span>
                    </span>
                    <button
                      type="button"
                      className={styles.iconButton}
                      data-remove=""
                      onClick={() => remove(rule, index)}
                      aria-label={`Remove rule: ${rule.tool.action}, ${
                        rule.scope === "agent" ? (rule.agent?.name ?? "one agent") : "any agent"
                      }`}
                    >
                      <X size={15} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </AutoHeight>
      </PopoverContent>
    </Popover>
  );
});

/* ───────────────────────── Resolved log ───────────────────────── */

const OUTCOME_LABEL: Record<ResolvedOutcome, string> = {
  approved: "Approved",
  denied: "Denied",
  allowed: "Allowed by rule",
};
const OUTCOME_ICON = { approved: Check, denied: X, allowed: ShieldCheck };

export function ResolvedLog({ entries, reduced, id }: { entries: ResolvedEntry[]; reduced: boolean; id: string }) {
  return (
    <ul id={id} className={styles.log} aria-label="Resolved requests">
      <AnimatePresence initial={false}>
        {entries.map((entry) => {
          const Icon = OUTCOME_ICON[entry.outcome];
          return (
            <motion.li key={entry.id} className={styles.logItem} {...listMotion(reduced)}>
              <div className={styles.logRow}>
                <ToolMark tool={entry.tool} className={styles.logMark} />
                <span className={styles.logText}>
                  <span className={styles.logSummary} title={entry.summary}>
                    {entry.summary}
                  </span>
                  <span className={styles.logMeta}>
                    <span className={styles.logOutcome} data-outcome={entry.outcome}>
                      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
                      {OUTCOME_LABEL[entry.outcome]}
                      {entry.edited ? " with edits" : ""}
                    </span>
                    <span>{entry.decidedBy === "Rule" ? entry.agentName : `by ${entry.decidedBy}`}</span>
                  </span>
                </span>
                <time className={styles.logTime} dateTime={entry.decidedAt}>
                  {clockTime(entry.decidedAt)}
                </time>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

/* ───────────────────────── Decision states ───────────────────────── */

interface DecisionProps {
  request: ApprovalRequest;
  state: CardState;
  reduced: boolean;
  workspace: string;
  workspaceMark?: ReactNode;
  demo: boolean;
  allowRef: RefObject<HTMLSpanElement | null>;
  onDecide: (outcome: "approved" | "denied") => void;
  onAlwaysAllow: (scope: "agent" | "workspace") => void;
}

function Decision({ request, state, reduced, workspace, workspaceMark, demo, allowRef, onDecide, onAlwaysAllow }: DecisionProps) {
  const { agent } = request;
  switch (state.phase) {
    case "sending":
      return (
        <p className={styles.line}>
          <TextShimmer active={!reduced}>
            {state.outcome === "denied" ? `Telling ${agent.name} no` : `Sending your approval to ${agent.name}`}
          </TextShimmer>
        </p>
      );
    case "done":
      if (state.outcome === "denied") {
        return (
          <p className={styles.line}>
            <X className={styles.lineIcon} data-tone="muted" size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>
              Denied<span className={styles.lineNote}>{agent.name} will not run it</span>
            </span>
          </p>
        );
      }
      if (state.rule) {
        return (
          <p className={styles.line}>
            <ShieldCheck className={styles.lineIcon} data-tone="accent" size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>
              Approved
              <span className={styles.lineNote}>
                {state.rule.scope === "agent"
                  ? `Always allowed for ${agent.name}`
                  : `Always allowed for any agent in ${workspace}`}
              </span>
            </span>
          </p>
        );
      }
      return (
        <p className={styles.line}>
          <Check className={styles.lineIcon} data-tone="success" size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>
            {state.edited ? "Approved with your edits" : "Approved"}
            <span className={styles.lineNote}>{demo ? "Simulated, nothing ran" : `${agent.name} can go ahead`}</span>
          </span>
        </p>
      );
    case "error":
      return (
        <div className={styles.errorRow} role="alert">
          <p className={styles.errorText}>
            <CircleAlert className={styles.lineIcon} data-tone="danger" size={16} strokeWidth={1.75} aria-hidden="true" />
            {state.message ?? "Your decision was not sent. Nothing ran."}
          </p>
          <span className={styles.actionsEnd}>
            <Button variant="ghost" size="sm" onClick={() => onDecide("denied")}>
              Deny
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onDecide(state.outcome === "denied" ? "denied" : "approved")}
            >
              <RotateCcw size={15} strokeWidth={1.75} aria-hidden="true" />
              Retry
            </Button>
          </span>
        </div>
      );
    default:
      return (
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" className={styles.deny} onClick={() => onDecide("denied")} aria-keyshortcuts="d">
            Deny
          </Button>
          <span className={styles.actionsEnd}>
            <span ref={allowRef} className={styles.allow}>
              <DropdownMenu
                label="Always allow"
                items={[
                  {
                    label: `For ${agent.name}`,
                    icon: <User size={16} strokeWidth={1.75} />,
                    onSelect: () => onAlwaysAllow("agent"),
                  },
                  {
                    label: `For any agent in ${workspace}`,
                    icon: workspaceMark ?? <Users size={16} strokeWidth={1.75} />,
                    onSelect: () => onAlwaysAllow("workspace"),
                  },
                ]}
              />
            </span>
            <Button size="sm" className={styles.approve} onClick={() => onDecide("approved")} aria-keyshortcuts="Enter a">
              Approve
              <Kbd keys="Enter" size="sm" className={styles.approveKbd} aria-hidden="true" />
            </Button>
          </span>
        </div>
      );
  }
}

const decisionKey = (state: CardState) =>
  state.phase === "idle" ? "idle" : `${state.phase}-${state.outcome ?? ""}-${state.rule ? "rule" : ""}`;

/* ───────────────────────── The request in focus ───────────────────────── */

export function FocusCard({
  request,
  state,
  edits,
  now,
  reduced,
  workspace,
  workspaceMark,
  demo,
  allowRef,
  onEdit,
  onRestore,
  onDecide,
  onAlwaysAllow,
}: Omit<DecisionProps, "state"> & {
  state: CardState;
  edits: Record<string, string>;
  now: number | null;
  onEdit: (key: string, value: string) => void;
  onRestore: (key: string) => void;
}) {
  const titleId = useId();
  const { agent, tool } = request;
  const open = state.phase === "idle" || state.phase === "error";

  return (
    <div className={styles.focus} role="group" aria-labelledby={titleId}>
      <div className={styles.focusMeta}>
        <span className={styles.agent}>
          <AgentMark agent={agent} className={styles.agentMark} />
          <span className={styles.agentName}>{agent.name}</span>
          <span className={styles.agentModel}>{agent.model}</span>
          <time
            className={styles.agentTime}
            dateTime={request.requestedAt}
            title={`Asked at ${clockTime(request.requestedAt)}`}
          >
            {relativeTime(request.requestedAt, now)}
          </time>
        </span>
        <RiskLabel risk={request.risk} long />
      </div>
      <h3 id={titleId} className={styles.focusTitle}>
        <ToolMark tool={tool} className={styles.titleMark} />
        <span className={styles.titleText}>
          <CallTitle text={request.title} />
          <span className={styles.srOnly}>, asked by {agent.name}</span>
        </span>
      </h3>
      <p className={styles.reason}>{request.reason}</p>
      <dl className={styles.args} aria-label="Arguments">
        {request.args.map((arg) => {
          const value = edits[arg.key] ?? arg.value;
          return (
            <ArgRow
              key={arg.key}
              arg={arg}
              value={value}
              edited={value !== arg.value}
              disabled={!open}
              onChange={(next) => onEdit(arg.key, next)}
              onRestore={() => onRestore(arg.key)}
            />
          );
        })}
      </dl>
      <AutoHeight reduced={reduced} className={styles.decisionSlot}>
        <div className={styles.decisionStack}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={decisionKey(state)}
              className={styles.decision}
              initial={{ opacity: 0, y: reduced ? 0 : 2 }}
              animate={{ opacity: 1, y: 0, transition: reduced ? { duration: 0 } : enterFast }}
              exit={{ opacity: 0, transition: reduced ? { duration: 0 } : exitQuick }}
            >
              <Decision
                request={request}
                state={state}
                reduced={reduced}
                workspace={workspace}
                workspaceMark={workspaceMark}
                demo={demo}
                allowRef={allowRef}
                onDecide={onDecide}
                onAlwaysAllow={onAlwaysAllow}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      </AutoHeight>
    </div>
  );
}
