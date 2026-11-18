import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch, type JSX } from "solid-js"
import { Button } from "../../primitives/button"
import { Shimmer } from "../tool-call"
import { applyDecisions, normalizeHunks, type Decisions, type Hunk } from "./apply"
import { CodeLine } from "./highlight"
export { applyDecisions }
import "./code-suggestion.css"

/**
 * Solid port of the Arc "Code suggestion" block (build-arc-code-suggestion): header (model mark, instruction,
 * model), editor tab (file mark, name, folder, +/− stats), the file with tinted hunks and a review bar per hunk
 * (Reject · Accept), and a footer with a live status and Reject all · Accept all ⌃↵.
 *
 * Panacode tweaks: OpenCode already applied the edit, so the card is built from the file as it was (`code`) and the
 * real hunks; Accept keeps a hunk, Reject asks the host to write the file back without it (`onDecision` may return
 * false to keep the hunk pending when the write fails). When the host reports a conflict (`rejectBlocked`), per-hunk
 * Reject is disabled and a per-file Undo is offered instead. No simulation.
 */

export type CodeSuggestionHunk = {
  id: string
  /** Zero based line where the change starts. */
  start: number
  /** Lines replaced from `start`. 0 inserts before `start`. */
  remove?: number
  /** Lines added. Empty deletes. */
  insert?: string[]
  summary?: string
}

export type CodeSuggestionStatus = "thinking" | "streaming" | "ready" | "error"
export type CodeSuggestionDecision = "accepted" | "rejected"

export type CodeSuggestionLabels = {
  reading: (file: string) => string
  writing: string
  noChanges: string
  toReview: (count: number) => string
  applied: (count: number) => string
  rejected: string
  mixed: (accepted: number, rejected: number) => string
  change: (index: number, total: number) => string
  reject: string
  accept: string
  rejectAll: string
  acceptAll: string
  stop: string
  retry: string
  undoFile: string
  regenerate: string
  unchanged: (count: number) => string
  added: (count: number) => string
  stats: (added: number, removed: number) => string
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

export const defaultCodeSuggestionLabels: CodeSuggestionLabels = {
  reading: (file) => `Reading ${file}`,
  writing: "Writing changes",
  noChanges: "No changes needed",
  toReview: (count) => `${plural(count, "change")} to review`,
  applied: (count) => (count === 1 ? "Change applied" : "All changes applied"),
  rejected: "Suggestion rejected",
  mixed: (accepted, rejected) => `${accepted} applied, ${rejected} rejected`,
  change: (index, total) => `Change ${index} of ${total}`,
  reject: "Reject",
  accept: "Accept",
  rejectAll: "Reject all",
  acceptAll: "Accept all",
  stop: "Stop",
  retry: "Retry",
  undoFile: "Undo turn",
  regenerate: "Regenerate",
  unchanged: (count) => `${count} unchanged lines`,
  added: (count) => `${count} lines added`,
  stats: (added, removed) => `${added} lines added, ${removed} removed`,
}

export type CodeSuggestionProps = {
  /** The file before the change. */
  code: string
  hunks: CodeSuggestionHunk[]
  status?: CodeSuggestionStatus
  instruction: string
  model?: { name: string; mark?: () => JSX.Element } | null
  fileName: string
  filePath?: string
  fileMark?: () => JSX.Element
  error?: string
  /** Return false (or a promise of false) to keep the hunk pending, e.g. when writing the file failed. */
  onDecision?: (hunk: CodeSuggestionHunk, decision: CodeSuggestionDecision, code: string) => boolean | void | Promise<boolean | void>
  onResolve?: (result: { code: string; accepted: string[]; rejected: string[] }) => void
  onStop?: () => void
  onRegenerate?: () => void
  /** Why per-hunk Reject is unavailable (the file changed since the edit). */
  rejectBlocked?: string
  /** Panacode: decisions already made before this card mounted (a hunk the file has reverted). */
  initialDecisions?: Partial<Record<string, CodeSuggestionDecision>>
  /** Per-file Undo offered while Reject is blocked. */
  onUndoFile?: () => void
  shortcuts?: boolean
  maxCodeHeight?: number
  /** Long files fold unchanged runs longer than this into one quiet row (Panacode). */
  foldContext?: number
  labels?: Partial<CodeSuggestionLabels>
  class?: string
}

type RowDecision = CodeSuggestionDecision | "pending"
type Row =
  | { kind: "ctx" | "add" | "del"; key: string; text: string; decision?: RowDecision; num?: number; hunk?: string }
  | { kind: "bar"; key: string; hunk: Hunk; index: number }
  | { kind: "fold"; key: string; count: number }
type Tone = "busy" | "review" | "done" | "muted" | "error"

const ROW_HEIGHT = 20
const BAR_HEIGHT = 40
const LEAVE_MS = 260

const isMac = () =>
  typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test((navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent)

function Spinner() {
  return (
    <svg class="cs-spinner" width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-opacity=".2" stroke-width="1.75" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
    </svg>
  )
}

function Lucide(props: { d: JSX.Element; width?: number; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.size ?? 16}
      height={props.size ?? 16}
      fill="none"
      stroke="currentColor"
      stroke-width={props.width ?? 1.75}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {props.d}
    </svg>
  )
}
const icons = {
  dot: () => <Lucide d={<><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="1" /></>} />,
  check: (width = 2) => <Lucide width={width} d={<path d="M20 6 9 17l-5-5" />} />,
  alert: () => <Lucide d={<><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" /></>} />,
  x: () => <Lucide d={<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>} />,
  rotate: () => <Lucide size={14} d={<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>} />,
}

export function CodeSuggestion(props: CodeSuggestionProps) {
  const labels = () => ({ ...defaultCodeSuggestionLabels, ...props.labels })
  // A file's final newline is not a line of its own; showing it adds an empty numbered row.
  const lines = createMemo(() => {
    const all = props.code.split("\n")
    if (all.length > 1 && all[all.length - 1] === "" && !(props.hunks ?? []).some((h) => h.start >= all.length - 1)) all.pop()
    return all
  })
  const hunks = createMemo(() => normalizeHunks(props.hunks, lines().length))
  const status = () => props.status ?? "ready"
  const shortcuts = () => props.shortcuts ?? true

  const [decisions, setDecisions] = createSignal<Decisions>({ ...props.initialDecisions })
  const [leaving, setLeaving] = createSignal<Decisions>({})
  const [busy, setBusy] = createSignal(false)
  const [announcement, setAnnouncement] = createSignal("")
  let root: HTMLDivElement | undefined
  let codeEl: HTMLDivElement | undefined

  // A new suggestion (different hunks) clears earlier decisions.
  createEffect(on(() => props.hunks.map((hunk) => hunk.id).join(","), () => setDecisions({ ...props.initialDecisions }), { defer: true }))

  const decisionOf = (id: string): RowDecision => decisions()[id] ?? "pending"
  const pendingIds = () => (status() === "ready" ? hunks().filter((h) => decisionOf(h.id) === "pending").map((h) => h.id) : [])
  const acceptedCount = () => hunks().filter((h) => decisionOf(h.id) === "accepted").length
  const rejectedCount = () => hunks().filter((h) => decisionOf(h.id) === "rejected").length

  const decide = async (ids: string[], decision: CodeSuggestionDecision, moveFocus = false) => {
    if (busy()) return
    const current = decisions()
    const fresh = ids.filter((id) => !current[id])
    if (!fresh.length) return
    if (decision === "rejected" && props.rejectBlocked) return
    const next: Decisions = { ...current }
    for (const id of fresh) next[id] = decision
    const nextCode = applyDecisions(props.code.split("\n"), props.hunks, next)
    setBusy(true)
    const results = await Promise.all(
      fresh.map(async (id) => {
        const hunk = hunks().find((item) => item.id === id)
        if (!hunk) return true
        try {
          return (await props.onDecision?.(hunk.source, decision, nextCode)) !== false
        } catch {
          return false
        }
      }),
    )
    setBusy(false)
    const done = fresh.filter((_, index) => results[index])
    if (!done.length) return
    // Rows that disappear fold out first, then the decision lands.
    setLeaving((value) => ({ ...value, ...Object.fromEntries(done.map((id) => [id, decision])) }))
    setTimeout(() => {
      setLeaving((value) => {
        const copy = { ...value }
        for (const id of done) delete copy[id]
        return copy
      })
      const settled: Decisions = { ...decisions(), ...Object.fromEntries(done.map((id) => [id, decision])) }
      setDecisions(settled)
      const verb = decision === "accepted" ? labels().accept : labels().reject
      const first = hunks().find((hunk) => hunk.id === done[0])
      setAnnouncement(done.length > 1 ? `${verb} ${done.length}` : `${verb}: ${first?.summary ?? ""}`)
      if (hunks().every((hunk) => settled[hunk.id]))
        props.onResolve?.({
          code: applyDecisions(props.code.split("\n"), props.hunks, settled),
          accepted: hunks().filter((h) => settled[h.id] === "accepted").map((h) => h.id),
          rejected: hunks().filter((h) => settled[h.id] === "rejected").map((h) => h.id),
        })
      if (moveFocus)
        requestAnimationFrame(() => {
          const nextId = hunks().find((hunk) => !settled[hunk.id])?.id
          const target = nextId ? root?.querySelector<HTMLElement>(`[data-accept="${CSS.escape(nextId)}"]`) : null
          ;(target ?? codeEl)?.focus({ preventScroll: true })
        })
    }, LEAVE_MS)
  }
  const acceptAll = (moveFocus = false) => decide(hunks().map((h) => h.id), "accepted", moveFocus)
  const rejectAll = (moveFocus = false) => decide(hunks().map((h) => h.id), "rejected", moveFocus)

  const rows = createMemo(() => {
    const list: Row[] = []
    let cursor = 0
    const all = lines()
    const fold = props.foldContext
    const context = (until: number, edge: "start" | "mid" | "end") => {
      const count = until - cursor
      if (fold !== undefined && count > fold * 2 + 1) {
        const head = edge === "start" ? 0 : fold
        const tail = edge === "end" ? 0 : fold
        for (let i = 0; i < head; i++, cursor++) list.push({ kind: "ctx", key: `c${cursor}`, text: all[cursor] })
        const skip = until - tail - cursor
        list.push({ kind: "fold", key: `f${cursor}`, count: skip })
        cursor += skip
      }
      for (; cursor < until; cursor++) list.push({ kind: "ctx", key: `c${cursor}`, text: all[cursor] })
    }
    hunks().forEach((hunk, index) => {
      context(hunk.start, index === 0 ? "start" : "mid")
      const decision = decisionOf(hunk.id)
      if (decision !== "accepted")
        for (let offset = 0; offset < hunk.remove; offset++) {
          const line = hunk.start + offset
          list.push({ kind: "del", key: `c${line}`, text: all[line], decision, hunk: hunk.id })
        }
      if (decision !== "rejected")
        hunk.insert.forEach((text, line) => list.push({ kind: "add", key: `${hunk.id}+${line}`, text, decision, hunk: hunk.id }))
      if (status() === "ready" && decision === "pending") list.push({ kind: "bar", key: `${hunk.id}-bar`, hunk, index })
      cursor = hunk.start + hunk.remove
    })
    context(all.length, "end")
    let num = 0
    for (const row of list) {
      if (row.kind === "bar") continue
      if (row.kind === "fold") {
        num += row.count
        continue
      }
      if (row.kind === "ctx" || (row.kind === "add" && row.decision !== "rejected") || (row.kind === "del" && row.decision === "rejected"))
        row.num = ++num
    }
    return list
  })

  const added = () => hunks().reduce((sum, h) => sum + (decisionOf(h.id) === "rejected" ? 0 : h.insert.length), 0)
  const removed = () => hunks().reduce((sum, h) => sum + (decisionOf(h.id) === "rejected" ? 0 : h.remove), 0)

  const tone = (): Tone => {
    if (status() === "thinking" || status() === "streaming") return "busy"
    if (status() === "error") return "error"
    if (!hunks().length) return "muted"
    if (pendingIds().length) return "review"
    if (rejectedCount() === hunks().length) return "muted"
    return "done"
  }
  const label = () => {
    const l = labels()
    if (status() === "thinking") return l.reading(props.fileName)
    if (status() === "streaming") return l.writing
    if (status() === "error") return props.error ?? ""
    if (!hunks().length) return l.noChanges
    if (pendingIds().length) return l.toReview(pendingIds().length)
    if (acceptedCount() === hunks().length) return l.applied(hunks().length)
    if (rejectedCount() === hunks().length) return l.rejected
    return l.mixed(acceptedCount(), rejectedCount())
  }
  const allRejected = () => status() === "ready" && hunks().length > 0 && rejectedCount() === hunks().length
  const iconKind = () => (tone() === "muted" && allRejected() ? "rejected" : tone())
  const actions = () => {
    if ((status() === "thinking" || status() === "streaming") && props.onStop) return "busy"
    if (status() === "error") return props.onRegenerate ? "error" : "none"
    if (pendingIds().length) return "review"
    if (status() === "ready" && props.onRegenerate) return "done"
    return "none"
  }

  createEffect(() => {
    const area = codeEl
    if (!area || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => area.style.setProperty("--cs-viewport", `${area.clientWidth}px`))
    observer.observe(area)
    onCleanup(() => observer.disconnect())
  })

  const onKeyDown = (event: KeyboardEvent) => {
    if (!shortcuts() || !(event.metaKey || event.ctrlKey)) return
    if (status() !== "ready" || !pendingIds().length) return
    if (event.key === "Enter") {
      event.preventDefault()
      void acceptAll(true)
    } else if (event.key === "Backspace" && !props.rejectBlocked) {
      event.preventDefault()
      void rejectAll(true)
    }
  }

  const leavingRow = (row: Row) => {
    if (row.kind !== "add" && row.kind !== "del" && row.kind !== "bar") return false
    const id = row.kind === "bar" ? row.hunk.id : row.hunk!
    const decision = leaving()[id]
    if (!decision) return false
    if (row.kind === "bar") return true
    return (row.kind === "del" && decision === "accepted") || (row.kind === "add" && decision === "rejected")
  }

  return (
    <div
      ref={root}
      role="group"
      aria-label={props.instruction}
      data-component="panacode-code-suggestion"
      class={`cs-root ${props.class ?? ""}`}
      data-status={status()}
      onKeyDown={onKeyDown}
    >
      <header class="cs-header">
        <span class="cs-model-mark" aria-hidden="true">
          {props.model?.mark?.()}
        </span>
        <p class="cs-instruction">{props.instruction}</p>
        <Show when={props.model}>{(model) => <p class="cs-model">{model().name}</p>}</Show>
      </header>
      <div class="cs-editor">
        <div class="cs-tabs">
          <span class="cs-tab">
            <Show when={props.fileMark}>
              {(mark) => (
                <span class="cs-file-mark" aria-hidden="true">
                  {mark()()}
                </span>
              )}
            </Show>
            <span class="cs-file-name">{props.fileName}</span>
            <Show when={props.filePath}>
              <span class="cs-file-path">{props.filePath}</span>
            </Show>
          </span>
          <span class="cs-stats">
            <span class="cs-sr-only">{labels().stats(added(), removed())}</span>
            <span class="cs-stat-add" data-zero={added() === 0 || undefined} aria-hidden="true">
              +{added()}
            </span>
            <span class="cs-stat-del" data-zero={removed() === 0 || undefined} aria-hidden="true">
              −{removed()}
            </span>
          </span>
        </div>
        <div
          ref={codeEl}
          class="cs-code"
          tabIndex={0}
          role="region"
          aria-label={props.fileName}
          style={props.maxCodeHeight ? { "max-height": `${props.maxCodeHeight}px`, "overflow-y": "auto" } : undefined}
        >
          <div class="cs-lines">
            <For each={rows()}>
              {(row) => (
                <Switch>
                  <Match when={row.kind === "bar" && row}>
                    {(bar) => {
                      const hunk = () => (bar() as Extract<Row, { kind: "bar" }>).hunk
                      const index = () => (bar() as Extract<Row, { kind: "bar" }>).index
                      return (
                        <div class="cs-bar-row cs-enter-bar" data-hunk-bar="" data-leaving={leavingRow(bar()) || undefined}>
                          <div class="cs-bar">
                            <span class="cs-bar-summary">{hunk().summary ?? labels().change(index() + 1, hunks().length)}</span>
                            <div class="cs-bar-actions">
                              <Button
                                size="sm"
                                variant="ghost"
                                class="cs-hunk-button cs-reject"
                                disabled={!!props.rejectBlocked || busy()}
                                title={props.rejectBlocked}
                                aria-label={`${labels().reject} ${hunk().summary ?? index() + 1}`}
                                onClick={() => void decide([hunk().id], "rejected", true)}
                              >
                                {labels().reject}
                              </Button>
                              <Button
                                size="sm"
                                variant="primary"
                                class="cs-hunk-button cs-accept"
                                data-accept={hunk().id}
                                disabled={busy()}
                                aria-label={`${labels().accept} ${hunk().summary ?? index() + 1}`}
                                onClick={() => void decide([hunk().id], "accepted", true)}
                              >
                                {labels().accept}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    }}
                  </Match>
                  <Match when={row.kind === "fold" && row}>
                    {(fold) => (
                      <div class="cs-row cs-fold-row" data-kind="ctx">
                        <span class="cs-gutter" aria-hidden="true">
                          <span class="cs-num">⋯</span>
                          <span class="cs-sign" />
                        </span>
                        <span class="cs-text cs-fold-text">{labels().unchanged((fold() as Extract<Row, { kind: "fold" }>).count)}</span>
                      </div>
                    )}
                  </Match>
                  <Match when={row.kind !== "bar" && row.kind !== "fold" && row}>
                    {(line) => {
                      const r = () => line() as Extract<Row, { kind: "ctx" | "add" | "del" }>
                      return (
                        <div
                          class="cs-row cs-enter-row"
                          data-kind={r().kind}
                          data-decision={r().kind === "ctx" ? undefined : r().decision}
                          data-leaving={leavingRow(r()) || undefined}
                        >
                          <span class="cs-gutter" aria-hidden="true">
                            <span class="cs-num">{r().num ?? ""}</span>
                            <span class="cs-sign">{r().kind === "add" ? "+" : r().kind === "del" ? "−" : ""}</span>
                          </span>
                          <CodeLine text={r().text} />
                        </div>
                      )
                    }}
                  </Match>
                </Switch>
              )}
            </For>
          </div>
        </div>
      </div>
      <Show when={props.rejectBlocked && pendingIds().length > 0}>
        <p class="cs-blocked-note">{props.rejectBlocked}</p>
      </Show>
      <div class="cs-footer">
        <div class="cs-status" aria-hidden="true">
          <span class="cs-status-icon">
            <span data-tone={tone()} class="cs-swap">
              <Switch fallback={icons.check(1.75)}>
                <Match when={iconKind() === "busy"}>
                  <Spinner />
                </Match>
                <Match when={iconKind() === "review"}>{icons.dot()}</Match>
                <Match when={iconKind() === "done"}>{icons.check()}</Match>
                <Match when={iconKind() === "error"}>{icons.alert()}</Match>
                <Match when={iconKind() === "rejected"}>{icons.x()}</Match>
              </Switch>
            </span>
          </span>
          <span class="cs-status-label">
            <span data-tone={tone()} class="cs-swap">
              <Show when={tone() === "busy"} fallback={<span class="cs-status-text">{label()}</span>}>
                <Shimmer active class="cs-status-text">
                  {label()}
                </Shimmer>
              </Show>
            </span>
          </span>
        </div>
        <div class="cs-actions-slot">
          <Show when={actions() !== "none"}>
            <div class="cs-actions cs-swap">
              <Show when={actions() === "busy"}>
                <Button size="sm" variant="secondary" class="cs-foot-button" onClick={() => props.onStop?.()}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                  </svg>
                  {labels().stop}
                </Button>
              </Show>
              <Show when={actions() === "review"}>
                <Show
                  when={!props.rejectBlocked}
                  fallback={
                    <Show when={props.onUndoFile}>
                      <Button size="sm" variant="secondary" class="cs-foot-button" title={props.rejectBlocked} onClick={() => props.onUndoFile?.()}>
                        {icons.rotate()}
                        {labels().undoFile}
                      </Button>
                    </Show>
                  }
                >
                  <Button
                    size="sm"
                    variant="secondary"
                    class="cs-foot-button"
                    disabled={busy()}
                    onClick={() => void rejectAll(true)}
                    aria-keyshortcuts={shortcuts() ? "Meta+Backspace Control+Backspace" : undefined}
                  >
                    {labels().rejectAll}
                  </Button>
                </Show>
                <Button
                  size="sm"
                  variant="primary"
                  class="cs-foot-button cs-accept"
                  disabled={busy()}
                  onClick={() => void acceptAll(true)}
                  aria-keyshortcuts={shortcuts() ? "Meta+Enter Control+Enter" : undefined}
                >
                  {labels().acceptAll}
                  <Show when={shortcuts()}>
                    <span class="cs-shortcut" aria-hidden="true">
                      {isMac() ? "⌘" : "Ctrl"}↵
                    </span>
                  </Show>
                </Button>
              </Show>
              <Show when={actions() === "done" || actions() === "error"}>
                <Button size="sm" variant="secondary" class="cs-foot-button" onClick={() => props.onRegenerate?.()}>
                  {icons.rotate()}
                  {actions() === "error" ? labels().retry : labels().regenerate}
                </Button>
              </Show>
            </div>
          </Show>
        </div>
      </div>
      <p class="cs-sr-only" aria-live="polite" role="status">
        {[announcement(), label()].filter(Boolean).join(". ")}
      </p>
    </div>
  )
}

export { ROW_HEIGHT, BAR_HEIGHT }
