import { createEffect, createMemo, createSignal, createUniqueId, For, Index, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { branchDownPath, branchUpPath, busY1, busY2, type Geometry } from "./geometry"
import {
  defaultOrchestratorLabels,
  type LaneStatus,
  type OrchestratorLabels,
  type OrchestratorLaneView,
  type OrchestratorView,
} from "./types"
import "./agent-orchestrator.css"

export * from "./types"

/**
 * Solid port of the Arc Agent Orchestrator (agent-orchestrator-ui-component). Controlled: the host passes the live
 * view built from a real turn, where the lead's subagent calls are the plan and each child session is a worker lane.
 * Lanes take a series color; connectors light up as work reaches a lane and comes back; a lane opens its transcript.
 */
export interface AgentOrchestratorProps {
  view: OrchestratorView
  labels?: Partial<OrchestratorLabels>
  onStop?: () => void
  onDismiss?: () => void
  onCopy?: (text: string) => void
  class?: string
}

const LIVE: LaneStatus[] = ["starting", "running"]
const ACTIVE: LaneStatus[] = ["starting", "running", "returned", "gaveup"]
const color = (i: number) => `var(--series-${(i % 4) + 1})`

const formatTokens = (value: number) => Math.round(value).toLocaleString("en-US")
const formatCost = (value: number) => `$${value.toFixed(4)}`
const seconds = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)}s`

function Icon(props: { d: () => JSX.Element; size?: number; class?: string; spin?: boolean }) {
  return (
    <svg
      class={props.class}
      classList={{ "pc-ao-spin": props.spin }}
      width={props.size ?? 14}
      height={props.size ?? 14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {props.d()}
    </svg>
  )
}

/** Factories: a JSX node can live in one place, so every icon gets its own paths. */
const glyph = {
  loader: () => <path d="M21 12a9 9 0 1 1-6.219-8.56" />,
  check: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  clock: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  alert: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </>
  ),
  stop: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </>
  ),
  chevron: () => <path d="m6 9 6 6 6-6" />,
  x: () => (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  copy: () => (
    <>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ),
  tick: () => <path d="M20 6 9 17l-5-5" />,
  square: () => <rect x="6" y="6" width="12" height="12" rx="2" />,
  bot: () => (
    <>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </>
  ),
}

function StatusGlyph(props: { status: LaneStatus | "lead-live" | "lead-done" | "lead-stopped" }) {
  const s = props.status
  if (s === "starting" || s === "running" || s === "lead-live") return <Icon d={glyph.loader} size={13} spin />
  if (s === "returned" || s === "lead-done") return <Icon d={glyph.check} size={13} />
  if (s === "gaveup") return <Icon d={glyph.alert} size={13} />
  if (s === "stopped" || s === "lead-stopped") return <Icon d={glyph.stop} size={13} />
  return <Icon d={glyph.clock} size={13} />
}

function Elapsed(props: { start?: number; end?: number; now: number }) {
  return <span class="pc-ao-num">{props.start ? seconds((props.end ?? props.now) - props.start) : "0.0s"}</span>
}

function LaneCard(props: {
  lane: OrchestratorLaneView
  index: number
  open: boolean
  now: number
  labels: OrchestratorLabels
  onToggle: () => void
  ref: (el: HTMLDivElement) => void
}) {
  const id = createUniqueId()
  const live = () => LIVE.includes(props.lane.status)
  const active = () => ACTIVE.includes(props.lane.status)
  const statusWord = () =>
    props.lane.status === "running" ? (props.lane.tool?.label ?? props.labels.thinking) : props.labels.status[props.lane.status]
  const detail = () => {
    const lane = props.lane
    if (lane.status === "running" && lane.tool) return { kind: "tool" as const, text: lane.tool.target || lane.tool.label }
    if (lane.status === "gaveup") return { kind: "error" as const, text: lane.error ?? props.labels.status.gaveup }
    if (lane.status === "running") return { kind: "muted" as const, text: props.labels.thinking }
    if (lane.status === "returned" || lane.status === "stopped") return { kind: "muted" as const, text: props.labels.toolCalls(lane.toolCount) }
    if (lane.status === "starting") return { kind: "muted" as const, text: props.labels.starting }
    return { kind: "muted" as const, text: lane.instruction ?? "" }
  }
  const output = () => (props.lane.status === "returned" ? (props.lane.result ?? props.lane.line) : props.lane.line)

  return (
    <div ref={props.ref} class="pc-ao-laneWrap" style={{ "--c": color(props.index) }} data-status={props.lane.status}>
      <div class="pc-ao-lane" classList={{ "is-active": active(), "is-live": live(), "is-failed": props.lane.status === "gaveup" }}>
        <button
          type="button"
          class="pc-ao-laneButton"
          aria-expanded={props.open}
          aria-controls={`${id}-log`}
          aria-label={`${props.lane.title}, ${props.lane.worker.name}, ${statusWord()}`}
          onClick={props.onToggle}
        >
          <span class="pc-ao-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${props.lane.progress})` }}>
              <Show when={live()}>
                <i class="pc-ao-sweep" />
              </Show>
            </span>
          </span>
          <span class="pc-ao-laneHead">
            <span class="pc-ao-worker">
              <span class="pc-ao-workerMark" aria-hidden="true">
                {props.lane.worker.mark ?? <Icon d={glyph.bot} size={14} />}
              </span>
              <span class="pc-ao-workerName">{props.lane.worker.name}</span>
            </span>
            <span class={`pc-ao-chip pc-ao-tone-${props.lane.status}`}>
              <StatusGlyph status={props.lane.status} />
              <span class="pc-ao-chipText" classList={{ "pc-ao-shimmer": live() }}>
                {statusWord()}
              </span>
            </span>
          </span>
          <span class="pc-ao-laneTitle">{props.lane.title}</span>
          <span class={`pc-ao-detail pc-ao-detail-${detail().kind}`}>{detail().text}</span>
          <span class="pc-ao-line" classList={{ "is-result": props.lane.status === "returned" }}>
            {output() || props.labels.noOutput}
          </span>
          <span class="pc-ao-laneFoot">
            <span class="pc-ao-usage">
              <span class="pc-ao-strong pc-ao-num">{formatTokens(props.lane.tokens)}</span>
              <span>{props.labels.tok}</span>
              <span aria-hidden="true" class="pc-ao-dot">
                ·
              </span>
              <span class="pc-ao-strong pc-ao-num">{formatCost(props.lane.cost)}</span>
            </span>
            <span class="pc-ao-time">
              <Elapsed start={props.lane.startedAt} end={props.lane.endedAt} now={props.now} />
              <Icon d={glyph.chevron} class={props.open ? "is-open" : ""} />
            </span>
          </span>
        </button>
        <Show when={props.open}>
          <ol id={`${id}-log`} class="pc-ao-transcript" aria-label={props.labels.transcript(props.lane.title)}>
            <Show when={props.lane.log.length > 0} fallback={<li class="pc-ao-muted">{props.labels.nothingYet}</li>}>
              <For each={props.lane.log.slice(-14)}>
                {(entry) => (
                  <li>
                    <span class="pc-ao-logAt">{(entry.at / 1000).toFixed(1)}s</span>
                    <span class={`pc-ao-logKind pc-ao-log-${entry.kind}`}>{props.labels.log[entry.kind]}</span>
                    <span class="pc-ao-logText" classList={{ "is-strong": entry.kind === "output" || entry.kind === "result" }}>
                      <Show when={entry.tool}>
                        <span class="pc-ao-logTool">{entry.tool}</span>{" "}
                      </Show>
                      {entry.text}
                    </span>
                  </li>
                )}
              </For>
            </Show>
          </ol>
        </Show>
      </div>
    </div>
  )
}

function Connectors(props: { geometry?: Geometry; lanes: OrchestratorLaneView[]; leadActive: boolean; summaryActive: boolean }) {
  return (
    <Show when={props.geometry && props.geometry.lanes.length > 0 ? props.geometry : undefined}>
      {(g) => {
        const stack = () => g().mode === "stack"
        const status = (i: number) => props.lanes[i]?.status ?? "planned"
        const anyActive = () => props.lanes.some((lane) => ACTIVE.includes(lane.status))
        const anyReturned = () => props.lanes.some((lane) => lane.status === "returned")
        return (
          <svg
            class="pc-ao-wires"
            aria-hidden="true"
            width={g().w}
            height={g().h}
            viewBox={`0 0 ${g().w} ${g().h}`}
          >
            <g class="pc-ao-wireBase">
              <Show
                when={stack()}
                fallback={
                  <>
                    <path d={`M${g().leadX} ${g().leadBottom}V${busY1(g())}`} />
                    <path d={`M${g().sumX} ${busY2(g())}V${g().sumTop}`} />
                  </>
                }
              >
                <path d={`M${g().leadX} ${g().leadBottom}V${g().sumTop}`} />
              </Show>
              <Index each={g().lanes}>
                {(_, i) => (
                  <>
                    <path d={branchDownPath(g(), i)} stroke-dasharray={status(i) === "planned" ? "3 4" : undefined} />
                    <Show when={!stack()}>
                      <path
                        d={branchUpPath(g(), i)}
                        stroke-dasharray={status(i) === "returned" ? undefined : "3 4"}
                      />
                    </Show>
                  </>
                )}
              </Index>
            </g>
            <g class="pc-ao-wireLit">
              <Index each={g().lanes}>
                {(_, i) => (
                  <g style={{ stroke: status(i) === "gaveup" ? "var(--danger)" : color(i) }}>
                    <path d={branchDownPath(g(), i)} style={{ opacity: ACTIVE.includes(status(i)) ? 1 : 0 }} />
                    <Show when={!stack()}>
                      <path d={branchUpPath(g(), i)} style={{ opacity: status(i) === "returned" ? 1 : 0 }} />
                    </Show>
                  </g>
                )}
              </Index>
            </g>
            <Show when={anyActive()}>
              <g class="pc-ao-wireTrunk">
                <Show when={!stack()} fallback={<path d={`M${g().leadX} ${g().leadBottom}V${g().sumTop}`} />}>
                  <path d={`M${g().leadX} ${g().leadBottom}V${busY1(g())}`} />
                  <Show when={anyReturned()}>
                    <path d={`M${g().sumX} ${busY2(g())}V${g().sumTop}`} />
                  </Show>
                </Show>
              </g>
            </Show>
            <g class="pc-ao-ports">
              <circle cx={g().leadX} cy={g().leadBottom} r="3.25" classList={{ "is-filled": props.leadActive }} style={{ "--pc": "var(--text-secondary)" }} />
              <circle
                cx={stack() ? g().leadX : g().sumX}
                cy={g().sumTop}
                r="3.25"
                classList={{ "is-filled": props.summaryActive }}
                style={{ "--pc": "var(--text-secondary)" }}
              />
              <Index each={g().lanes}>
                {(lane, i) => (
                  <g style={{ "--pc": status(i) === "gaveup" ? "var(--danger)" : color(i) }}>
                    <Show
                      when={!stack()}
                      fallback={<circle cx={lane().left} cy={lane().cy} r="3.25" classList={{ "is-filled": ACTIVE.includes(status(i)) }} />}
                    >
                      <circle cx={lane().x} cy={lane().top} r="3.25" classList={{ "is-filled": ACTIVE.includes(status(i)) }} />
                      <circle cx={lane().x} cy={lane().bottom} r="3.25" classList={{ "is-filled": status(i) === "returned" }} />
                    </Show>
                  </g>
                )}
              </Index>
            </g>
          </svg>
        )
      }}
    </Show>
  )
}

export function AgentOrchestrator(props: AgentOrchestratorProps) {
  const labels = () => ({ ...defaultOrchestratorLabels, ...props.labels })
  const [now, setNow] = createSignal(Date.now())
  const [open, setOpen] = createSignal<ReadonlySet<string>>(new Set())
  const [geometry, setGeometry] = createSignal<Geometry>()
  const [width, setWidth] = createSignal(0)
  const [copied, setCopied] = createSignal(false)
  let flow: HTMLDivElement | undefined
  let body: HTMLDivElement | undefined
  // When the lead's summary lands, bring it into view inside the capped body.
  createEffect(
    on(
      () => props.view.phase,
      (phase, prev) => {
        if (phase === "done" && prev && prev !== "done") requestAnimationFrame(() => body?.scrollTo({ top: body.scrollHeight, behavior: "smooth" }))
      },
    ),
  )
  let lead: HTMLElement | undefined
  let summary: HTMLElement | undefined
  const laneEls: HTMLDivElement[] = []

  const live = () => props.view.phase === "planning" || props.view.phase === "running" || props.view.phase === "summarizing"
  createEffect(() => {
    if (!live()) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    onCleanup(() => clearInterval(timer))
  })

  const count = () => props.view.lanes.length
  const wide = () => width() >= Math.max(560, count() * 168) && count() <= 4

  const measure = () => {
    if (!flow || !lead || !summary) return
    const box = flow.getBoundingClientRect()
    if (!box.width) return
    const rel = (r: DOMRect) => ({ left: r.left - box.left, top: r.top - box.top, right: r.right - box.left, bottom: r.bottom - box.top, width: r.width })
    const l = rel(lead.getBoundingClientRect())
    const s = rel(summary.getBoundingClientRect())
    const mode = wide() ? "wide" : "stack"
    const lanes = laneEls.slice(0, count()).flatMap((el) => {
      if (!el?.isConnected) return []
      const r = rel(el.getBoundingClientRect())
      return [{ x: r.left + r.width / 2, top: r.top, bottom: r.bottom, left: r.left, cy: r.top + 26 }]
    })
    setGeometry({
      mode,
      w: box.width,
      h: box.height,
      leadX: mode === "wide" ? l.left + l.width / 2 : l.left + 24,
      leadBottom: l.bottom,
      sumX: s.left + s.width / 2,
      sumTop: s.top,
      lanes,
    })
  }

  onMount(() => {
    if (!flow) return
    const observer = new ResizeObserver(() => {
      setWidth(flow!.getBoundingClientRect().width)
      requestAnimationFrame(measure)
    })
    observer.observe(flow)
    onCleanup(() => observer.disconnect())
  })
  createEffect(
    on(
      () => [props.view.lanes.map((lane) => `${lane.id}:${lane.status}:${open().has(lane.id)}:${lane.line.length > 0}`).join("|"), wide(), props.view.summary.length > 0, props.view.phase],
      () => requestAnimationFrame(measure),
    ),
  )

  const returnedCount = () => props.view.lanes.filter((lane) => lane.status === "returned" || lane.status === "gaveup").length
  const leadWord = () => {
    const phase = props.view.phase
    if (phase === "planning") return labels().planning
    if (phase === "summarizing") return labels().summarizing
    if (phase === "done") return labels().done
    if (phase === "stopped") return labels().stopped
    if (props.view.lanes.every((lane) => lane.status === "planned" || lane.status === "starting")) return labels().dispatching
    return labels().returned(returnedCount(), count())
  }
  const leadGlyph = () =>
    props.view.phase === "done" ? "lead-done" : props.view.phase === "stopped" ? "lead-stopped" : "lead-live"

  const totals = createMemo(() => {
    const lanes = props.view.lanes
    const tokens = lanes.reduce((sum, lane) => sum + lane.tokens, 0)
    const cost = lanes.reduce((sum, lane) => sum + lane.cost, 0)
    const wallMs = (props.view.endedAt ?? now()) - props.view.startedAt
    const sequentialMs = lanes.reduce(
      (sum, lane) => sum + (lane.startedAt && lane.endedAt ? lane.endedAt - lane.startedAt : 0),
      0,
    )
    const starts = lanes.flatMap((lane) => (lane.startedAt ? [lane.startedAt] : []))
    const ends = lanes.flatMap((lane) => (lane.endedAt ? [lane.endedAt] : []))
    const parallelMs = starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : 0
    const speedup = parallelMs > 0 ? sequentialMs / parallelMs : 1
    return { tokens, cost, wallMs, sequentialMs, parallelMs, speedup }
  })

  const toggle = (id: string) =>
    setOpen((all) => {
      const next = new Set(all)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <section class={`pc-ao ${props.class ?? ""}`} data-component="panacode-agent-orchestrator" data-phase={props.view.phase} aria-label={props.view.goal}>
      <header class="pc-ao-header">
        <div class="pc-ao-heading">
          <span class="pc-ao-eyebrow">
            {labels().eyebrow}
            <span class="pc-ao-badge">{labels().parallelLanes(count())}</span>
          </span>
          <h2 title={props.view.goal}>{props.view.goal}</h2>
        </div>
        <div class="pc-ao-actions">
          <Show when={live() && props.onStop}>
            <button type="button" class="pc-ao-primary" onClick={() => props.onStop?.()}>
              <Icon d={glyph.square} size={12} />
              {labels().stop}
            </button>
          </Show>
          <Show when={!live() && props.onDismiss}>
            <button type="button" class="pc-ao-iconButton" data-action="orchestrator-dismiss" aria-label={labels().dismiss} title={labels().dismiss} onClick={() => props.onDismiss?.()}>
              <Icon d={glyph.x} size={16} />
            </button>
          </Show>
        </div>
      </header>

      <div ref={body} class="pc-ao-body">
      <div ref={flow} class="pc-ao-flow" data-mode={wide() ? "wide" : "stack"}>
        <Connectors
          geometry={geometry()}
          lanes={props.view.lanes}
          leadActive={true}
          summaryActive={props.view.phase === "summarizing" || props.view.phase === "done"}
        />
        <section ref={lead} class="pc-ao-card pc-ao-lead" aria-label={labels().lead}>
          <div class="pc-ao-cardHead">
            <span class="pc-ao-leadMark" aria-hidden="true">
              {props.view.lead.mark?.() ?? <Icon d={glyph.bot} size={14} />}
            </span>
            <span class="pc-ao-leadName">
              <span>{props.view.lead.name}</span>
              <span class="pc-ao-muted">{labels().lead}</span>
            </span>
            <span class="pc-ao-leadStatus" classList={{ "is-live": live(), "is-done": props.view.phase === "done" }}>
              <StatusGlyph status={leadGlyph()} />
              <span classList={{ "pc-ao-shimmer": live() }}>{leadWord()}</span>
            </span>
            <span class="pc-ao-muted pc-ao-leadTime">
              <Elapsed start={props.view.startedAt} end={props.view.endedAt} now={now()} />
            </span>
          </div>
          <ol class="pc-ao-plan" aria-label={labels().plan}>
            <Show when={count() > 0} fallback={<li class="pc-ao-muted pc-ao-breathe">{labels().planning}…</li>}>
              <For each={props.view.lanes}>
                {(lane, i) => (
                  <li style={{ "--c": color(i()) }}>
                    <span class="pc-ao-planDot" aria-hidden="true" />
                    <p>
                      <span class="pc-ao-planIndex">{i() + 1}.</span>
                      <span class="pc-ao-planTitle">{lane.title}</span>
                      <Show when={lane.instruction}>
                        <span class="pc-ao-planInstruction">
                          {" "}
                          <span aria-hidden="true" class="pc-ao-muted">
                            —
                          </span>{" "}
                          {lane.instruction}
                        </span>
                      </Show>
                    </p>
                  </li>
                )}
              </For>
            </Show>
          </ol>
        </section>

        <div class="pc-ao-lanes" style={wide() ? { "grid-template-columns": `repeat(${Math.max(1, count())}, minmax(0, 1fr))` } : undefined}>
          <For each={props.view.lanes}>
            {(lane, i) => (
              <LaneCard
                lane={lane}
                index={i()}
                open={open().has(lane.id)}
                now={now()}
                labels={labels()}
                onToggle={() => toggle(lane.id)}
                ref={(el) => (laneEls[i()] = el)}
              />
            )}
          </For>
        </div>

        <section ref={summary} class="pc-ao-card pc-ao-summary" aria-label={labels().summary}>
          <div class="pc-ao-cardHead">
            <span class="pc-ao-leadMark" aria-hidden="true">
              {props.view.lead.mark?.() ?? <Icon d={glyph.bot} size={14} />}
            </span>
            <span class="pc-ao-leadName">
              <span>{labels().summary}</span>
              <span class="pc-ao-muted">{props.view.lead.name}</span>
            </span>
            <Show when={props.view.phase === "done" && props.view.summary}>
              <button
                type="button"
                class="pc-ao-iconButton pc-ao-copy"
                aria-label={copied() ? labels().copied : labels().copy}
                title={copied() ? labels().copied : labels().copy}
                onClick={() => {
                  props.onCopy?.(props.view.summary)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1400)
                }}
              >
                <Icon d={copied() ? glyph.tick : glyph.copy} size={14} />
              </button>
            </Show>
          </div>
          <div class="pc-ao-summaryBody">
            <Show
              when={props.view.summary}
              fallback={<p class="pc-ao-muted">{props.view.phase === "stopped" ? labels().summaryStopped : labels().summaryWaiting}</p>}
            >
              <p>{props.view.summary}</p>
            </Show>
          </div>
          <Show when={props.view.phase === "done"}>
            <div class="pc-ao-totals">
              <dl>
                <div>
                  <dt>{labels().tokens}</dt>
                  <dd class="pc-ao-num">{formatTokens(totals().tokens)}</dd>
                </div>
                <div>
                  <dt>{labels().cost}</dt>
                  <dd class="pc-ao-num">{formatCost(totals().cost)}</dd>
                </div>
                <div>
                  <dt>{labels().wallTime}</dt>
                  <dd class="pc-ao-num">{seconds(totals().wallMs)}</dd>
                </div>
                <div>
                  <dt>{labels().speedup}</dt>
                  <dd class="pc-ao-num pc-ao-ok">{totals().speedup.toFixed(1)}×</dd>
                </div>
              </dl>
              <div class="pc-ao-compare" role="group" aria-label={labels().compare}>
                <div>
                  <span>{labels().inParallel}</span>
                  <span class="pc-ao-bar">
                    <i style={{ transform: `scaleX(${Math.min(1, totals().parallelMs / Math.max(1, totals().sequentialMs))})`, background: "var(--success)" }} />
                  </span>
                  <span class="pc-ao-num pc-ao-strong">{seconds(totals().parallelMs)}</span>
                </div>
                <div>
                  <span>{labels().inSequence}</span>
                  <span class="pc-ao-bar">
                    <i style={{ transform: "scaleX(1)", background: "var(--text-muted)" }} />
                  </span>
                  <span class="pc-ao-num pc-ao-muted">{seconds(totals().sequentialMs)}</span>
                </div>
              </div>
            </div>
          </Show>
        </section>
      </div>
      </div>
      <p class="pc-ao-sr" role="status" aria-live="polite">
        {leadWord()}
      </p>
    </section>
  )
}
