import { createMemo, createSignal, For, Index, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { Button } from "../../primitives/button"
import { ApprovalIcon, type ApprovalIconName } from "./icons"
import "./agent-approvals.css"

/**
 * Solid port of the Arc "Agent approvals" block (replicate-agent-approvals-component).
 * One focus card for the waiting tool call (who asked, risk, tool mark + title, reason, arguments),
 * the decision row (Deny · Always allow · Approve ⏎), the queue of other pending calls,
 * and a footer with the resolved log and keyboard hints.
 *
 * Panacode tweaks: arguments are read-only (OpenCode replies cannot rewrite tool input), and
 * "Always allow" is a single action because OpenCode saves the rule per project.
 */

export type ApprovalRisk = "low" | "medium" | "high"
export type ApprovalDecision = "approved" | "denied" | "always"
export type ApprovalOutcome = "approved" | "denied" | "allowed"

export type ApprovalArgument = { key: string; label: string; value: string; mono?: boolean }

export type ApprovalRequest = {
  id: string
  /** Backticks set code in the mono face. */
  title: string
  /** Short form for the queue and the log. */
  summary?: string
  reason?: string
  risk: ApprovalRisk
  icon?: ApprovalIconName
  /** Left part of the meta row (the asking agent or tool). */
  source: string
  /** Muted detail next to the source (model, tool id). */
  sourceDetail?: string
  requestedAt?: number
  args: ApprovalArgument[]
}

export type ApprovalResolved = { id: string; summary: string; outcome: ApprovalOutcome; at: number; icon?: ApprovalIconName }

export type ApprovalLabels = {
  title: string
  pending: (count: number) => string
  approve: string
  deny: string
  always: string
  risk: Record<ApprovalRisk, string>
  riskWord: string
  justNow: string
  minutesAgo: (minutes: number) => string
  sending: string
  denying: string
  resolved: (count: number) => string
  outcome: Record<ApprovalOutcome, string>
  hintMove: string
  hintApprove: string
  hintDeny: string
  arguments: string
}

export const defaultApprovalLabels: ApprovalLabels = {
  title: "Approvals",
  pending: (count) => `${count} pending`,
  approve: "Approve",
  deny: "Deny",
  always: "Always allow",
  risk: { low: "Low", medium: "Medium", high: "High" },
  riskWord: "risk",
  justNow: "Just now",
  minutesAgo: (minutes) => `${minutes} min ago`,
  sending: "Sending your approval",
  denying: "Sending your denial",
  resolved: (count) => `Resolved · ${count}`,
  outcome: { approved: "Approved", denied: "Denied", allowed: "Always allowed" },
  hintMove: "Move",
  hintApprove: "Approve",
  hintDeny: "Deny",
  arguments: "Arguments",
}

export interface AgentApprovalsProps {
  requests: readonly ApprovalRequest[]
  resolved?: readonly ApprovalResolved[]
  /** Id of the request whose decision is in flight. */
  sending?: { id: string; decision: ApprovalDecision }
  onDecision: (id: string, decision: ApprovalDecision) => void
  labels?: Partial<ApprovalLabels>
  class?: string
}

const RISK_ICON: Record<ApprovalRisk, ApprovalIconName> = { low: "shieldCheck", medium: "shieldAlert", high: "shieldX" }
const OUTCOME_ICON: Record<ApprovalOutcome, ApprovalIconName> = { approved: "check", denied: "x", allowed: "shieldCheck" }

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" })

function CallTitle(props: { text: string }) {
  return (
    <Index each={props.text.split("`")}>
      {(part, index) => (index % 2 ? <code data-slot="approval-code">{part()}</code> : <span>{part()}</span>)}
    </Index>
  )
}

export function RiskLabel(props: { risk: ApprovalRisk; labels: ApprovalLabels; long?: boolean }) {
  return (
    <span data-slot="approval-risk" data-risk={props.risk}>
      <ApprovalIcon name={RISK_ICON[props.risk]} size={15} />
      <span>
        {props.labels.risk[props.risk]}
        <span data-slot={props.long ? "approval-risk-word" : "approval-sr"}> {props.labels.riskWord}</span>
      </span>
    </span>
  )
}

function Kbd(props: { keys: string[] }) {
  return (
    <span data-slot="approval-kbd" aria-hidden="true">
      <For each={props.keys}>{(key) => <kbd>{key}</kbd>}</For>
    </span>
  )
}

const editable = (target: EventTarget | null) => {
  const el = target as HTMLElement | null
  if (!el || !(el instanceof HTMLElement)) return false
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName) || !!el.closest("[role=menu],[role=dialog]")
}

export function AgentApprovals(props: AgentApprovalsProps) {
  const labels = createMemo<ApprovalLabels>(() => ({ ...defaultApprovalLabels, ...props.labels }))
  const [focusId, setFocusId] = createSignal<string>()
  const [logOpen, setLogOpen] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())

  const focus = createMemo(() => props.requests.find((r) => r.id === focusId()) ?? props.requests[0])
  const queue = createMemo(() => props.requests.filter((r) => r.id !== focus()?.id))
  const sending = (id: string) => (props.sending?.id === id ? props.sending.decision : undefined)

  const ago = (at?: number) => {
    if (!at) return labels().justNow
    const minutes = Math.max(0, Math.round((now() - at) / 60000))
    return minutes < 1 ? labels().justNow : minutes < 60 ? labels().minutesAgo(minutes) : clock.format(at)
  }

  const decide = (decision: ApprovalDecision) => {
    const current = focus()
    if (!current || props.sending) return
    props.onDecision(current.id, decision)
  }

  const move = (step: number) => {
    const list = props.requests
    if (list.length < 2) return
    const index = Math.max(0, list.findIndex((r) => r.id === focus()?.id))
    setFocusId(list[(index + step + list.length) % list.length].id)
  }

  onMount(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15e3)
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || editable(event.target)) return
      const key = event.key.toLowerCase()
      if (key === "enter" || key === "a") decide("approved")
      else if (key === "d") decide("denied")
      else if (key === "j") move(1)
      else if (key === "k") move(-1)
      else return
      event.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => {
      window.clearInterval(timer)
      window.removeEventListener("keydown", onKey)
    })
  })

  return (
    <section
      data-component="panacode-agent-approvals"
      data-panacode-feature="agent-approvals"
      class={props.class}
      aria-label={labels().title}
    >
      <header data-slot="approvals-header">
        <h2 data-slot="approvals-title">{labels().title}</h2>
        <span data-slot="approvals-count">{labels().pending(props.requests.length)}</span>
      </header>

      <Show when={focus()} keyed>
        {(request) => (
          <div data-slot="approval-focus-area">
            <article data-slot="approval" data-risk={request.risk} role="group" aria-labelledby={`approval-${request.id}`}>
              <div data-slot="approval-meta">
                <span data-slot="approval-source">
                  <ApprovalIcon name={request.icon ?? "wrench"} size={15} />
                  <span data-slot="approval-source-name">{request.source}</span>
                  <Show when={request.sourceDetail}>
                    <span data-slot="approval-source-detail">{request.sourceDetail}</span>
                  </Show>
                  <time data-slot="approval-time" title={request.requestedAt ? clock.format(request.requestedAt) : undefined}>
                    {ago(request.requestedAt)}
                  </time>
                </span>
                <RiskLabel risk={request.risk} labels={labels()} long />
              </div>
              <h3 id={`approval-${request.id}`} data-slot="approval-title">
                <ApprovalIcon name={request.icon ?? "wrench"} size={20} class="approval-title-mark" />
                <span data-slot="approval-title-text">
                  <CallTitle text={request.title} />
                </span>
              </h3>
              <Show when={request.reason}>
                <p data-slot="approval-reason">{request.reason}</p>
              </Show>
              <Show when={request.args.length > 0}>
                <dl data-slot="approval-args" aria-label={labels().arguments}>
                  <For each={request.args}>
                    {(arg) => (
                      <div data-slot="approval-arg" data-key={arg.key}>
                        <dt>{arg.label}</dt>
                        <dd data-mono={arg.mono ? "" : undefined}>{arg.value}</dd>
                      </div>
                    )}
                  </For>
                </dl>
              </Show>
              <div data-slot="approval-decision">
                <Switch>
                  <Match when={sending(request.id)}>
                    {(decision) => (
                      <p data-slot="approval-line" data-motion="swap">
                        <span data-slot="approval-shimmer">
                          {decision() === "denied" ? labels().denying : labels().sending}
                        </span>
                      </p>
                    )}
                  </Match>
                  <Match when={true}>
                    <div data-slot="approval-actions" data-motion="swap">
                      <Button
                        variant="ghost"
                        size="sm"
                        data-action="approval-deny"
                        aria-keyshortcuts="d"
                        disabled={!!props.sending}
                        onClick={() => decide("denied")}
                      >
                        {labels().deny}
                      </Button>
                      <span data-slot="approval-actions-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          data-action="approval-always"
                          disabled={!!props.sending}
                          onClick={() => decide("always")}
                        >
                          {labels().always}
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          data-action="approval-approve"
                          aria-keyshortcuts="Enter a"
                          disabled={!!props.sending}
                          onClick={() => decide("approved")}
                        >
                          {labels().approve}
                          <Kbd keys={["Enter"]} />
                        </Button>
                      </span>
                    </div>
                  </Match>
                </Switch>
              </div>
            </article>
          </div>
        )}
      </Show>

      <Show when={queue().length > 0}>
        <ul data-slot="approvals-queue">
          <For each={queue()}>
            {(request) => (
              <li data-slot="approvals-queue-item">
                <button type="button" data-slot="approvals-row" onClick={() => setFocusId(request.id)}>
                  <ApprovalIcon name={request.icon ?? "wrench"} size={15} />
                  <span data-slot="approvals-row-text">
                    <span data-slot="approvals-row-summary">{request.summary ?? request.title.replaceAll("`", "")}</span>
                    <span data-slot="approvals-row-source">{request.source}</span>
                  </span>
                  <RiskLabel risk={request.risk} labels={labels()} />
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <footer data-slot="approvals-footer">
        <Show when={(props.resolved?.length ?? 0) > 0} fallback={<span />}>
          <button
            type="button"
            data-slot="approvals-log-toggle"
            aria-expanded={logOpen()}
            onClick={() => setLogOpen((open) => !open)}
          >
            <ApprovalIcon name="chevron" size={14} class="approvals-chevron" />
            <span>{labels().resolved(props.resolved?.length ?? 0)}</span>
          </button>
        </Show>
        <span data-slot="approvals-hints">
          <Show when={props.requests.length > 1}>
            <span data-slot="approvals-hint">
              <Kbd keys={["J", "K"]} />
              {labels().hintMove}
            </span>
          </Show>
          <span data-slot="approvals-hint">
            <Kbd keys={["A"]} />
            {labels().hintApprove}
          </span>
          <span data-slot="approvals-hint">
            <Kbd keys={["D"]} />
            {labels().hintDeny}
          </span>
        </span>
      </footer>

      <div data-slot="approvals-log-wrap" data-open={logOpen() ? "" : undefined}>
        <Show when={logOpen()}>
          <ol data-slot="approvals-log">
            <For each={props.resolved}>
              {(entry) => (
                <li data-slot="approvals-log-row">
                  <ApprovalIcon name={entry.icon ?? "wrench"} size={15} />
                  <span data-slot="approvals-log-summary">{entry.summary}</span>
                  <span data-slot="approvals-log-meta">{clock.format(entry.at)}</span>
                  <span data-slot="approvals-log-outcome" data-outcome={entry.outcome}>
                    <ApprovalIcon name={OUTCOME_ICON[entry.outcome]} size={15} />
                    {labels().outcome[entry.outcome]}
                  </span>
                </li>
              )}
            </For>
          </ol>
        </Show>
      </div>
    </section>
  )
}

