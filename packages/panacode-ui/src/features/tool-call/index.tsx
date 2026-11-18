import { createEffect, createMemo, createSignal, createUniqueId, For, Index, on, onCleanup, Show, untrack, type JSX } from "solid-js"
import { Collapse } from "../../motion/presence"
import { prefersReducedMotion } from "../../motion/reduced"
import "./tool-call.css"

/**
 * Solid port of the Arc "Tool call" block (recreate-arc-tool-call-component): one inline call row
 * (mark · title with running shimmer · chevron · meta · status icon, inline Allow/Deny or Retry,
 * reason line, and an Input/Output panel with copy, list/table/json/text views and folds), and
 * ToolCallGroup ("Used 4 tools" with the stacked marks and total duration, auto-open on a decision,
 * auto-fold 450ms after the work settles unless touched).
 *
 * Panacode tweak: no local simulation. Status comes from real tool state, and Allow/Deny/Retry only
 * render when the host wires a handler.
 */

export type ToolCallStatus = "running" | "success" | "error" | "approval" | "denied"
export type ToolCallValue = string | number | boolean | null | ToolCallValue[] | { [key: string]: ToolCallValue }
export type ToolCallCell = string | number | boolean | null
export interface ToolCallListItem {
  lead?: string
  title: string
  tag?: string
}
export type ToolCallOutput =
  | { type: "list"; items: ToolCallListItem[] }
  | { type: "table"; columns: string[]; rows: ToolCallCell[][] }
  | { type: "json"; value: ToolCallValue }
  | { type: "text"; text: string }

/** A tool: its name (for labels) and a 16px mark. */
export type ToolCallTool = { key?: string; name: string; mark: () => JSX.Element }

export interface ToolCallData {
  id: string
  tool: ToolCallTool
  title: string
  titles?: Partial<Record<ToolCallStatus, string>>
  status: ToolCallStatus
  input?: Record<string, ToolCallValue>
  output?: ToolCallOutput
  summary?: string
  message?: string
  durationMs?: number
}

export type ToolCallLabels = {
  input: string
  output: string
  copy: string
  copied: string
  copyFailed: string
  allow: string
  deny: string
  retry: string
  notRun: string
  showLess: string
  showMore: (count: number, unit: "row" | "line") => string
  empty: Record<ToolCallStatus, string>
  status: (status: ToolCallStatus, summary?: string, duration?: string, message?: string) => string
  used: (count: number, working: boolean) => string
  count: (count: number, unit: "result" | "row" | "item" | "field") => string
}

const plural = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`

export const defaultToolCallLabels: ToolCallLabels = {
  input: "Input",
  output: "Output",
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Copy failed",
  allow: "Allow",
  deny: "Deny",
  retry: "Retry",
  notRun: "Not run",
  showLess: "Show less",
  showMore: (count, unit) => `Show ${count} more ${count === 1 ? unit : `${unit}s`}`,
  empty: {
    running: "Waiting for the result",
    success: "No output",
    error: "No output",
    approval: "Runs after it is allowed",
    denied: "Never ran",
  },
  status: (status, summary, duration, message) => {
    switch (status) {
      case "running":
        return "Running"
      case "success":
        return ["Done", summary, duration].filter(Boolean).join(", ")
      case "error":
        return message ? `Failed. ${message}` : "Failed"
      case "approval":
        return message ? `Waiting for approval. ${message}` : "Waiting for approval"
      case "denied":
        return "Denied, the call never ran"
    }
  },
  used: (count, working) => `${working ? "Using" : "Used"} ${plural(count, "tool")}`,
  count: (count, unit) => plural(count, unit),
}

const FOLD_ROWS = 5
const FOLD_LINES = 10
const ROW_HEIGHT = 28
const LINE_HEIGHT = 20
const JSON_PADDING = 16
const MARK_STEP = 14
const MARK_SIZE = 20
const SWEEP = 1.8

/** 640ms below a second, 1.2s below a minute, then 1m 12s. */
export function formatDuration(ms?: number): string | undefined {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return undefined
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) {
    const seconds = ms / 1000
    return `${seconds < 10 ? seconds.toFixed(1).replace(/\.0$/, "") : Math.round(seconds)}s`
  }
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`
}

function deriveSummary(labels: ToolCallLabels, output?: ToolCallOutput): string | undefined {
  if (!output) return undefined
  switch (output.type) {
    case "list":
      return labels.count(output.items.length, "result")
    case "table":
      return labels.count(output.rows.length, "row")
    case "json": {
      const value = output.value
      if (Array.isArray(value)) return labels.count(value.length, "item")
      if (value && typeof value === "object") return labels.count(Object.keys(value).length, "field")
      return undefined
    }
    case "text":
      return undefined
  }
}

const cellText = (cell: ToolCallCell) => (cell === null ? "null" : String(cell))
const valueKind = (value: ToolCallValue) => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value)
const valueText = (value: ToolCallValue) =>
  typeof value === "string" ? value : value !== null && typeof value === "object" ? JSON.stringify(value) : String(value)

function outputText(output: ToolCallOutput): string {
  switch (output.type) {
    case "list":
      return output.items
        .map((item, i) => [item.lead ?? `${i + 1}.`, item.title, item.tag ? `[${item.tag}]` : ""].filter(Boolean).join(" "))
        .join("\n")
    case "table":
      return [output.columns, ...output.rows.map((row) => row.map(cellText))].map((row) => row.join("\t")).join("\n")
    case "json":
      return JSON.stringify(output.value, null, 2)
    case "text":
      return output.text
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/* Shimmer: the band is the text color over a muted base and settles to solid. Same gradient math as Arc. */
const band = 2.2
const falloff = [
  [-1, 0],
  [-0.5, 0.5],
  [-0.2, 0.9],
  [0, 1],
  [0.2, 0.9],
  [0.5, 0.5],
  [1, 0],
] as const
const percent = (value: number) => `${(value * 100).toFixed(1)}%`
function shimmerImage(t: number, settle: number) {
  const base = `color-mix(in oklab, var(--ts-highlight) ${percent(settle)}, var(--ts-base))`
  const stops = falloff.map(
    ([offset, strength]) =>
      `color-mix(in oklab, var(--ts-highlight) ${percent(strength)}, ${base}) calc(${(t * 100).toFixed(2)}% + ${((2 * t - 1 + offset) * band).toFixed(3)}em)`,
  )
  return `linear-gradient(90deg, ${base}, ${stops.join(", ")}, ${base})`
}

export function Shimmer(props: { children: string; active: boolean; class?: string }) {
  const reduced = prefersReducedMotion()
  const [image, setImage] = createSignal(shimmerImage(0, props.active ? 0 : 1))
  let sweep = 0
  let settle = props.active ? 0 : 1
  let frame = 0
  let last = 0
  let wait = 0.12
  let settleFrom = settle
  let settleAt = 0
  const ease = (x: number) => 1 - Math.pow(1 - x, 3)

  const tick = (now: number) => {
    const dt = last ? (now - last) / 1000 : 0
    last = now
    const target = props.active ? 0 : 1
    const span = props.active ? 0.24 : 0.36
    const progress = Math.min(1, (now - settleAt) / 1000 / span)
    settle = settleFrom + (target - settleFrom) * ease(progress)
    if (props.active && !reduced()) {
      if (wait > 0) wait -= dt
      else {
        sweep += dt / SWEEP
        if (sweep >= 1) {
          sweep = 0
          wait = SWEEP * 0.32
        }
      }
    } else if (sweep > 0 && sweep < 1 && !reduced()) sweep = Math.min(1, sweep + dt / 0.42)
    setImage(shimmerImage(sweep, settle))
    if (props.active || progress < 1) frame = requestAnimationFrame(tick)
    else frame = 0
  }

  createEffect(
    on(
      () => props.active,
      () => {
        settleFrom = settle
        settleAt = performance.now()
        last = 0
        if (!frame) frame = requestAnimationFrame(tick)
      },
    ),
  )
  onCleanup(() => cancelAnimationFrame(frame))

  return (
    <span class={`pc-tc-shimmer ${props.class ?? ""}`} style={{ "background-image": image() }}>
      {props.children}
    </span>
  )
}

/* Lucide glyphs used by the block (stroke 1.75). */
function Glyph(props: { name: "check" | "alert" | "shield" | "ban" | "copy" | "chevronRight" | "chevronDown"; width?: number; class?: string }) {
  const paths: Record<string, JSX.Element> = {
    check: <path d="M20 6 9 17l-5-5" />,
    alert: (
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" x2="12" y1="8" y2="12" />
        <line x1="12" x2="12.01" y1="16" y2="16" />
      </>
    ),
    shield: (
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    ),
    ban: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="m4.9 4.9 14.2 14.2" />
      </>
    ),
    copy: (
      <>
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </>
    ),
    chevronRight: <path d="m9 18 6-6-6-6" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
  }
  return (
    <svg
      class={props.class}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width={props.width ?? 1.75}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {paths[props.name]}
    </svg>
  )
}

function CheckDraw(props: { draw: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3.25 8.5 6.5 11.75 12.75 4.75" pathLength="1" class="pc-tc-checkPath" data-draw={props.draw ? "" : undefined} />
    </svg>
  )
}

function StatusIcon(props: { status: ToolCallStatus; draw: boolean }) {
  return (
    <span class="pc-tc-statusBox" aria-hidden="true">
      <Index each={[props.status]}>
        {(status) => (
          <span class="pc-tc-statusIcon pc-tc-pop">
            <Show when={status() === "running"}>
              <span class="pc-tc-spinner" />
            </Show>
            <Show when={status() === "success"}>
              <CheckDraw draw={props.draw} />
            </Show>
            <Show when={status() === "error"}>
              <Glyph name="alert" />
            </Show>
            <Show when={status() === "approval"}>
              <Glyph name="shield" />
            </Show>
            <Show when={status() === "denied"}>
              <Glyph name="ban" />
            </Show>
          </span>
        )}
      </Index>
    </span>
  )
}

function CopyButton(props: { text: string; what: string; labels: ToolCallLabels; announce: (text: string) => void }) {
  const [state, setState] = createSignal<"idle" | "copied" | "failed">("idle")
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const click = async () => {
    const ok = await copyText(props.text)
    setState(ok ? "copied" : "failed")
    props.announce(ok ? `${props.labels.copied} ${props.what}` : `${props.labels.copyFailed} ${props.what}`)
    clearTimeout(timer)
    timer = setTimeout(() => setState("idle"), 1800)
  }
  return (
    <button type="button" class="pc-tc-copy" data-state={state()} onClick={click} aria-label={`${props.labels.copy} ${props.what}`}>
      <span class="pc-tc-copyIcon" aria-hidden="true">
        <Show when={state() === "copied"} fallback={<Glyph name={state() === "failed" ? "alert" : "copy"} />}>
          <Glyph name="check" width={2} />
        </Show>
      </span>
      <span class="pc-tc-copyLabels" aria-hidden="true">
        <span data-active={state() === "idle"}>{props.labels.copy}</span>
        <span data-active={state() === "copied"}>{props.labels.copied}</span>
        <span data-active={state() === "failed"}>{props.labels.copyFailed}</span>
      </span>
    </button>
  )
}

function useFold(total: () => number, visible: number) {
  const [expanded, setExpanded] = createSignal(false)
  const folds = () => total() > visible
  const shown = () => (folds() && !expanded() ? visible : total())
  return { folds, expanded, shown, toggle: () => setExpanded((value) => !value) }
}

function ShowMore(props: { expanded: boolean; hidden: number; unit: "row" | "line"; labels: ToolCallLabels; onToggle: () => void }) {
  return (
    <button type="button" class="pc-tc-more" aria-expanded={props.expanded} onClick={props.onToggle}>
      <Glyph name="chevronDown" />
      {props.expanded ? props.labels.showLess : props.labels.showMore(props.hidden, props.unit)}
    </button>
  )
}

const foldStyle = (height: number) => ({
  height: `${height}px`,
  transition: "height var(--spring-smooth-duration, 400ms) var(--spring-smooth, ease)",
})

function ListView(props: { items: ToolCallListItem[] }) {
  return (
    <ol class="pc-tc-list">
      <For each={props.items}>
        {(item, i) => (
          <li class="pc-tc-listItem">
            <span class="pc-tc-lead pc-tc-mono">{item.lead ?? `${i() + 1}.`}</span>
            <span class="pc-tc-itemTitle">{item.title}</span>
            <Show when={item.tag}>
              <span class="pc-tc-tag">{item.tag}</span>
            </Show>
          </li>
        )}
      </For>
    </ol>
  )
}

function TableView(props: { columns: string[]; rows: ToolCallCell[][]; labels: ToolCallLabels }) {
  const fold = useFold(() => props.rows.length, FOLD_ROWS)
  const numeric = createMemo(() =>
    props.columns.map((_, c) => props.rows.length > 0 && props.rows.every((row) => typeof row[c] === "number" || row[c] === null)),
  )
  return (
    <>
      <div class="pc-tc-scroll">
        <div class="pc-tc-fold" style={foldStyle(ROW_HEIGHT + fold.shown() * ROW_HEIGHT)}>
          <table class="pc-tc-table pc-tc-mono">
            <thead>
              <tr>
                <For each={props.columns}>{(column, c) => <th scope="col" data-num={numeric()[c()]}>{column}</th>}</For>
              </tr>
            </thead>
            <tbody>
              <For each={props.rows}>
                {(row, r) => (
                  <tr aria-hidden={r() >= fold.shown() || undefined} inert={r() >= fold.shown() || undefined}>
                    <For each={row}>
                      {(cell, c) => (
                        <td data-num={numeric()[c()]} data-kind={cell === null ? "null" : undefined}>
                          {cellText(cell)}
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </div>
      <Show when={fold.folds()}>
        <ShowMore expanded={fold.expanded()} hidden={props.rows.length - FOLD_ROWS} unit="row" labels={props.labels} onToggle={fold.toggle} />
      </Show>
    </>
  )
}

const jsonToken = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b/g

function tintJson(line: string): JSX.Element[] {
  const parts: JSX.Element[] = []
  let last = 0
  jsonToken.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = jsonToken.exec(line))) {
    if (match.index > last) parts.push(line.slice(last, match.index))
    if (match[1] !== undefined) {
      parts.push(<span class={match[2] ? "pc-tc-jsonKey" : "pc-tc-jsonString"}>{match[1]}</span>)
      if (match[2]) parts.push(match[2])
    } else if (match[3] !== undefined) parts.push(<span class="pc-tc-jsonNumber">{match[3]}</span>)
    else if (match[4] !== undefined) parts.push(<span class="pc-tc-jsonBoolean">{match[4]}</span>)
    else parts.push(<span class="pc-tc-jsonNull">{match[5]}</span>)
    last = jsonToken.lastIndex
  }
  if (last < line.length) parts.push(line.slice(last))
  return parts
}

function JsonView(props: { value: ToolCallValue; labels: ToolCallLabels }) {
  const lines = createMemo(() => JSON.stringify(props.value, null, 2).split("\n"))
  return <LinesView lines={lines()} tint labels={props.labels} />
}

/** Text output folds like JSON (Panacode: shell and tool text can be long). */
function LinesView(props: { lines: string[]; tint?: boolean; labels: ToolCallLabels }) {
  const fold = useFold(() => props.lines.length, FOLD_LINES)
  return (
    <>
      <div class="pc-tc-scroll">
        <div
          class="pc-tc-fold"
          style={foldStyle((fold.shown() < props.lines.length ? JSON_PADDING / 2 : JSON_PADDING) + fold.shown() * LINE_HEIGHT)}
        >
          <pre class="pc-tc-json pc-tc-mono">
            <For each={props.lines}>
              {(line, i) => (
                <span class="pc-tc-line" aria-hidden={i() >= fold.shown() || undefined} inert={i() >= fold.shown() || undefined}>
                  {props.tint ? tintJson(line) : line}
                </span>
              )}
            </For>
          </pre>
        </div>
      </div>
      <Show when={fold.folds()}>
        <ShowMore expanded={fold.expanded()} hidden={props.lines.length - FOLD_LINES} unit="line" labels={props.labels} onToggle={fold.toggle} />
      </Show>
    </>
  )
}

function OutputView(props: { output: ToolCallOutput; labels: ToolCallLabels }) {
  const output = props.output
  switch (output.type) {
    case "list":
      return <ListView items={output.items} />
    case "table":
      return <TableView columns={output.columns} rows={output.rows} labels={props.labels} />
    case "json":
      return <JsonView value={output.value} labels={props.labels} />
    case "text":
      return output.text.includes("\n") ? (
        <LinesView lines={output.text.replace(/\n$/, "").split("\n")} labels={props.labels} />
      ) : (
        <p class="pc-tc-textOut">{output.text}</p>
      )
  }
}

export interface ToolCallProps extends ToolCallData {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onApprove?: () => void
  onDeny?: () => void
  onRetry?: () => void
  /** Custom result for a successful call inside the Output well. Return undefined for the built in view. */
  renderOutput?: (call: ToolCallData) => JSX.Element | undefined
  /**
   * Panacode: says whether renderOutput has a view for this call without building it, so a custom view that
   * loads data (a file read) is only created while the row is open.
   */
  hasOutput?: (call: ToolCallData) => boolean
  labels?: Partial<ToolCallLabels>
  class?: string
}

export function ToolCall(props: ToolCallProps) {
  const labels = () => ({ ...defaultToolCallLabels, ...props.labels })
  const uid = createUniqueId()
  const panelId = `${uid}-panel`

  const label = () =>
    props.titles?.[props.status] ?? (props.status === "denied" ? props.titles?.approval : undefined) ?? props.title
  const running = () => props.status === "running"
  const summary = () => (props.status === "success" ? (props.summary ?? deriveSummary(labels(), props.output)) : undefined)
  const duration = () => (props.status === "success" || props.status === "error" ? formatDuration(props.durationMs) : undefined)
  const sentence = () => labels().status(props.status, summary(), duration(), props.message)
  const hasCustom = createMemo(() => {
    if (props.status !== "success" || !props.renderOutput) return false
    if (props.hasOutput) return props.hasOutput(props)
    return untrack(() => props.renderOutput!(props)) !== undefined
  })
  const custom = () => (hasCustom() ? props.renderOutput!(props) : undefined)
  const expandable = () => Boolean(props.input || props.output || hasCustom())

  const [openState, setOpenState] = createSignal(props.defaultOpen ?? false)
  const open = () => expandable() && (props.open ?? openState())
  const toggle = () => {
    if (!expandable()) return
    const next = !open()
    if (props.open === undefined) setOpenState(next)
    props.onOpenChange?.(next)
  }

  const [announcement, setAnnouncement] = createSignal("")
  let queue: string[] = []
  let announceTimer: ReturnType<typeof setTimeout> | undefined
  const announce = (text: string) => {
    queue.push(text)
    clearTimeout(announceTimer)
    setAnnouncement("")
    announceTimer = setTimeout(() => {
      setAnnouncement(queue.join(" "))
      queue = []
    }, 40)
  }
  onCleanup(() => clearTimeout(announceTimer))

  const [changed, setChanged] = createSignal(false)
  createEffect(
    on(
      () => props.status,
      (status, prev) => {
        if (prev === undefined || prev === status) return
        setChanged(true)
        announce(`${props.tool.name}: ${label()}. ${sentence()}`)
      },
    ),
  )

  // Keep the shimmer mounted briefly after running ends so the title settles to solid instead of cutting.
  const [settling, setSettling] = createSignal(false)
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(
    on(running, (now, was) => {
      clearTimeout(settleTimer)
      if (now || !was) return setSettling(false)
      setSettling(true)
      settleTimer = setTimeout(() => setSettling(false), 520)
    }),
  )
  onCleanup(() => clearTimeout(settleTimer))

  let mounted = false
  queueMicrotask(() => (mounted = true))

  return (
    <div
      data-component="panacode-tool-call"
      class={`pc-tc-call ${props.class ?? ""}`}
      data-status={props.status}
      data-open={open() || undefined}
    >
      <div class="pc-tc-inner">
        <button
          type="button"
          class="pc-tc-row"
          data-static={expandable() ? undefined : "true"}
          aria-expanded={expandable() ? open() : undefined}
          aria-controls={expandable() ? panelId : undefined}
          aria-label={`${props.tool.name}: ${label()} ${sentence()}`}
          onClick={toggle}
        >
          <span class="pc-tc-mark" aria-hidden="true">
            {props.tool.mark()}
          </span>
          <span class="pc-tc-text">
            <span class="pc-tc-title">
              <Index each={[label()]}>
                {(text) => (
                  <span class="pc-tc-titleLabel" data-enter={mounted ? "" : undefined}>
                    <Show when={running() || settling()} fallback={text()}>
                      <Shimmer active={running()}>{text()}</Shimmer>
                    </Show>
                  </span>
                )}
              </Index>
            </span>
            <Glyph name="chevronRight" width={2} class="pc-tc-chevron" />
          </span>
          <span class="pc-tc-meta" aria-hidden="true">
            <Show when={summary()}>
              <span class="pc-tc-summary">{summary()}</span>
            </Show>
            <Show when={summary() && duration()}>
              <span class="pc-tc-dot" />
            </Show>
            <Show when={duration()}>
              <span>{duration()}</span>
            </Show>
            <Show when={props.status === "denied"}>
              <span>{labels().notRun}</span>
            </Show>
          </span>
          <StatusIcon status={props.status} draw={changed()} />
        </button>

        <Show when={props.status === "approval" && (props.onApprove || props.onDeny)}>
          <div class="pc-tc-actions">
            <button type="button" class="pc-tc-action pc-tc-deny" onClick={() => props.onDeny?.()} aria-label={`${labels().deny}: ${label()}`}>
              {labels().deny}
            </button>
            <button type="button" class="pc-tc-action pc-tc-allow" onClick={() => props.onApprove?.()} aria-label={`${labels().allow}: ${label()}`}>
              {labels().allow}
            </button>
          </div>
        </Show>
        <Show when={props.status === "error" && props.onRetry}>
          <div class="pc-tc-actions">
            <button type="button" class="pc-tc-action pc-tc-retry" onClick={() => props.onRetry?.()} aria-label={`${labels().retry}: ${label()}`}>
              {labels().retry}
            </button>
          </div>
        </Show>

        <Show when={props.message && (props.status === "error" || props.status === "approval")}>
          <p class="pc-tc-message">{props.message}</p>
        </Show>

        <Collapse open={open()} id={panelId} class="pc-tc-panel" appear>
          <div class="pc-tc-panelInner">
            <Show when={props.input}>
              {(input) => (
                <div class="pc-tc-section">
                  <div class="pc-tc-sectionHead">
                    <span class="pc-tc-sectionLabel" id={`${uid}-input`}>
                      {labels().input}
                    </span>
                    <CopyButton text={JSON.stringify(input(), null, 2)} what={labels().input.toLowerCase()} labels={labels()} announce={announce} />
                  </div>
                  <div class="pc-tc-well">
                    <dl class="pc-tc-kv pc-tc-mono" aria-labelledby={`${uid}-input`}>
                      <For each={Object.entries(input())}>
                        {([key, value]) => (
                          <div class="pc-tc-kvRow">
                            <dt>{key}</dt>
                            <dd data-kind={valueKind(value)}>{valueText(value)}</dd>
                          </div>
                        )}
                      </For>
                    </dl>
                  </div>
                </div>
              )}
            </Show>
            <div class="pc-tc-section">
              <div class="pc-tc-sectionHead">
                <span class="pc-tc-sectionLabel">{labels().output}</span>
                <Show when={props.output && !hasCustom() && props.status !== "denied" && props.status !== "approval"}>
                  <CopyButton text={outputText(props.output!)} what={labels().output.toLowerCase()} labels={labels()} announce={announce} />
                </Show>
              </div>
              <div class="pc-tc-well">
                <Show
                  when={hasCustom()}
                  fallback={
                    <Show
                      when={props.output && props.status !== "denied" && props.status !== "approval" ? props.output : undefined}
                      fallback={<p class="pc-tc-empty">{labels().empty[props.status]}</p>}
                    >
                      {(output) => <OutputView output={output()} labels={labels()} />}
                    </Show>
                  }
                >
                  <div class="pc-tc-custom">{custom()}</div>
                </Show>
              </div>
            </div>
          </div>
        </Collapse>
      </div>
      <span class="pc-tc-srOnly" role="status" aria-live="polite" aria-atomic="true">
        {announcement()}
      </span>
    </div>
  )
}

export interface ToolCallGroupProps {
  calls: ToolCallData[]
  /** The agent is still working in this turn. Defaults to any call running. */
  active?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Folds the list 450ms after every call has finished, unless the person touched the group. */
  autoCollapse?: boolean
  onApprove?: (call: ToolCallData) => void
  onDeny?: (call: ToolCallData) => void
  onRetry?: (call: ToolCallData) => void
  renderOutput?: (call: ToolCallData) => JSX.Element | undefined
  hasOutput?: (call: ToolCallData) => boolean
  /** Panacode: a row in the group can be a different block (thinking, a code suggestion). */
  renderCall?: (call: ToolCallData) => JSX.Element | undefined
  /** Extra rows appended after the calls (events, notices). */
  after?: JSX.Element
  labels?: Partial<ToolCallLabels>
  class?: string
}

/**
 * Several calls from one assistant turn under a quiet header, "Used 4 tools", with an overlapping stack of
 * the tools' marks and the total duration. A call that needs a decision opens a closed group; the group folds
 * itself away once every call has finished unless the person has opened or closed anything.
 */
export function ToolCallGroup(props: ToolCallGroupProps) {
  const labels = () => ({ ...defaultToolCallLabels, ...props.labels })
  const uid = createUniqueId()
  const listId = `${uid}-list`

  const anyRunning = () => props.calls.some((call) => call.status === "running")
  const working = () => props.active ?? anyRunning()
  const unsettled = () => props.calls.some((call) => call.status === "running" || call.status === "approval" || call.status === "error")
  const needsDecision = () => props.calls.some((call) => call.status === "approval")
  const settled = () => !working() && props.calls.every((call) => call.status === "success" || call.status === "denied")

  const controlled = () => props.open !== undefined
  const [openState, setOpenState] = createSignal(props.defaultOpen ?? unsettled())
  const open = () => (controlled() ? props.open! : openState())
  let touched = false
  const setOpen = (next: boolean, byPerson: boolean) => {
    if (byPerson) touched = true
    if (!controlled()) setOpenState(next)
    props.onOpenChange?.(next)
  }

  createEffect(
    on(needsDecision, (now, was) => {
      if (now && was === false && !controlled() && !open()) setOpen(true, false)
    }),
  )

  let foldTimer: ReturnType<typeof setTimeout> | undefined
  let sawWork = !settled()
  createEffect(
    on(settled, (done) => {
      clearTimeout(foldTimer)
      if (!done) {
        sawWork = true
        return
      }
      if (!sawWork) return
      sawWork = false
      if (props.autoCollapse === false || touched || !open()) return
      foldTimer = setTimeout(() => {
        if (!touched && open()) setOpen(false, false)
      }, 450)
    }),
  )
  onCleanup(() => clearTimeout(foldTimer))

  const tools = createMemo(() => {
    const seen = new Map<string, ToolCallTool>()
    for (const call of props.calls) {
      const key = call.tool.key ?? call.tool.name
      if (!seen.has(key)) seen.set(key, call.tool)
    }
    return Array.from(seen.values())
  })
  const stackWidth = () => (tools().length ? MARK_SIZE + (tools().length - 1) * MARK_STEP : 0)
  const totalLabel = () => {
    const total = props.calls.reduce((sum, call) => sum + (call.durationMs ?? 0), 0)
    return total > 0 ? formatDuration(total) : undefined
  }
  const headline = () => labels().used(props.calls.length, working())
  const initial = new Set(props.calls.map((call) => call.id))

  return (
    <div data-component="panacode-tool-call-group" class={`pc-tc-group ${props.class ?? ""}`}>
      <button type="button" class="pc-tc-groupHead" aria-expanded={open()} aria-controls={listId} onClick={() => setOpen(!open(), true)}>
        <span class="pc-tc-stack" aria-hidden="true" style={{ width: `${stackWidth()}px` }}>
          <For each={tools()}>
            {(tool, index) => (
              <span class="pc-tc-stackMark pc-tc-pop" style={{ left: `${index() * MARK_STEP}px` }}>
                {tool.mark()}
              </span>
            )}
          </For>
        </span>
        <span class="pc-tc-groupLabel">
          <Show when={working()} fallback={headline()}>
            <Shimmer active>{headline()}</Shimmer>
          </Show>
        </span>
        <Glyph name="chevronRight" width={2} class="pc-tc-chevron" />
        <Show when={totalLabel()}>
          <span class="pc-tc-groupMeta">{totalLabel()}</span>
        </Show>
      </button>
      <Collapse open={open()} id={listId} class="pc-tc-groupList" appear>
        <div class="pc-tc-listBody">
          <For each={props.calls}>
            {(call, index) => (
              <div
                class="pc-tc-listRow"
                data-enter={initial.has(call.id) ? "stagger" : "grow"}
                style={{ "--pc-tc-index": index() }}
              >
                {props.renderCall?.(call) ?? (
                  <ToolCall
                    {...call}
                    labels={props.labels}
                    onOpenChange={() => (touched = true)}
                    onApprove={props.onApprove ? () => props.onApprove!(call) : undefined}
                    onDeny={props.onDeny ? () => props.onDeny!(call) : undefined}
                    onRetry={props.onRetry ? () => props.onRetry!(call) : undefined}
                    renderOutput={props.renderOutput}
                    hasOutput={props.hasOutput}
                  />
                )}
              </div>
            )}
          </For>
          {props.after}
        </div>
      </Collapse>
    </div>
  )
}
