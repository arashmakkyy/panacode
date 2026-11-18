import { DropdownMenu } from "@kobalte/core/dropdown-menu"
import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { prefersReducedMotion } from "../../motion/reduced"
import "./parts.css"

/**
 * Solid ports of the Arc AI Composer parts (replicate-arc-ai-composer parts.tsx): the send button that turns
 * into stop with its progress ring, the effort control (Effort head with its hint, segmented levels with a
 * sliding thumb), and the attachment chip with its upload ring, check and remove glyphs.
 */

/* ------------------------------------------------------------ send / stop */

export type SendState = "empty" | "blocked" | "ready" | "generating"

const ArrowUp = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="m5 12 7-7 7 7" />
    <path d="M12 19V5" />
  </svg>
)

export function SendButton(
  props: {
    state: SendState
    /** 0 to 1 while the reply's length is known; null spins the ring (a live reply has no length yet). */
    progress?: number | null
    label: string
    onSend: () => void
    onStop: () => void
    /** Panacode: the glyph while a send is held (agents and models still loading). */
    held?: boolean
  } & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">,
) {
  const reduced = prefersReducedMotion()
  const generating = () => props.state === "generating"
  const usable = () => props.state === "ready" || generating()
  const known = () => props.progress !== null && props.progress !== undefined
  const offset = () => (known() ? 1 - Math.max(0.02, props.progress!) : 0.72)
  const [pressed, setPressed] = createSignal(false)
  const rest = () => {
    const { state, progress, label, onSend, onStop, held, ...others } = props
    void state, progress, label, onSend, onStop, held
    return others
  }
  return (
    <button
      type="button"
      {...rest()}
      class="pc-aic-send"
      data-state={props.state}
      data-held={props.held || undefined}
      data-pressed={pressed() || undefined}
      aria-label={props.label}
      title={props.label}
      aria-disabled={!usable() || undefined}
      onPointerDown={() => usable() && !reduced() && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (generating()) props.onStop()
        else if (props.state === "ready") props.onSend()
      }}
    >
      <svg
        class="pc-aic-sendRing"
        data-spin={((generating() || props.held) && !known() && !reduced()) || undefined}
        viewBox="0 0 44 44"
        aria-hidden="true"
      >
        <circle class="pc-aic-sendTrack" cx="22" cy="22" r="20.5" data-on={generating() || props.held || undefined} />
        <circle
          class="pc-aic-sendArc"
          cx="22"
          cy="22"
          r="20.5"
          pathLength={1}
          stroke-dasharray="1 1"
          data-on={generating() || props.held || undefined}
          style={{ "stroke-dashoffset": generating() || props.held ? offset() : 1 }}
        />
      </svg>
      <Show when={generating()} keyed fallback={<span class="pc-aic-sendGlyph pc-aic-arrowIn"><ArrowUp /></span>}>
        <span class="pc-aic-sendGlyph pc-aic-stopIn">
          <span class="pc-aic-stopGlyph" />
        </span>
      </Show>
    </button>
  )
}

/* ----------------------------------------------------------------- effort */

export type EffortOption = { id: string; label: string; hint?: string }

export function EffortMenu(props: {
  options: EffortOption[]
  value: string
  onChange: (id: string) => void
  /** "Effort" */
  heading: string
  /** The trigger's accessible name, e.g. "Choose effort". */
  label: string
  /** Panacode: the trigger shows the model before the effort when given. */
  lead?: JSX.Element
  class?: string
}) {
  const current = createMemo(() => props.options.find((option) => option.id === props.value) ?? props.options[0])
  const index = createMemo(() => Math.max(0, props.options.findIndex((option) => option.id === props.value)))
  let row: HTMLDivElement | undefined

  const move = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    const items = Array.from(row?.querySelectorAll<HTMLElement>("[role='menuitemradio']") ?? [])
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    event.preventDefault()
    const rtl = getComputedStyle(row!).direction === "rtl"
    const step = (event.key === "ArrowRight") !== rtl ? 1 : -1
    items[(at + step + items.length) % items.length]?.focus()
  }

  return (
    <DropdownMenu gutter={8} placement="top-end">
      <DropdownMenu.Trigger
        class={`pc-aic-modelChip ${props.class ?? ""}`}
        data-action="composer-effort"
        aria-label={`${props.label}: ${current()?.label ?? ""}`}
      >
        {props.lead}
        <span class="pc-aic-modelEffort">{current()?.label}</span>
        <svg class="pc-aic-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="pc-aic-menu pc-aic-effortMenu" data-component="panacode-effort-menu">
          <div class="pc-aic-effortHead">
            <span>{props.heading}</span>
            <span class="pc-aic-effortHint">{current()?.hint}</span>
          </div>
          <DropdownMenu.RadioGroup value={props.value} onChange={(value) => props.onChange(value)}>
            <div
              ref={row}
              class="pc-aic-effortRow"
              style={{ "--pc-aic-effort-count": props.options.length, "--pc-aic-effort-index": index() }}
              onKeyDown={move}
            >
              <span class="pc-aic-effortThumb" aria-hidden="true" />
              <For each={props.options}>
                {(option) => (
                  <DropdownMenu.RadioItem value={option.id} class="pc-aic-effortItem" closeOnSelect={false}>
                    <span class="pc-aic-effortText">{option.label}</span>
                  </DropdownMenu.RadioItem>
                )}
              </For>
            </div>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}

/* ------------------------------------------------------------ attachments */

export type AttachmentStatus = "uploading" | "done" | "error" | "ready"

function ProgressRing(props: { progress: number }) {
  return (
    <svg class="pc-aic-ring" viewBox="0 0 18 18" aria-hidden="true">
      <circle class="pc-aic-ringTrack" cx="9" cy="9" r="7" />
      <circle class="pc-aic-ringFill" cx="9" cy="9" r="7" pathLength={1} stroke-dasharray="1 1" style={{ "stroke-dashoffset": 1 - props.progress }} />
    </svg>
  )
}

export function AttachmentChip(props: {
  name: string
  /** "PDF · 2 MB", or the error. */
  meta?: string
  status: AttachmentStatus
  progress?: number
  /** A 38px thumbnail for images. */
  thumb?: string
  glyph?: JSX.Element
  removeLabel: string
  uploadingLabel?: (percent: number) => string
  onOpen?: (element: HTMLElement) => void
  onRemove: () => void
}) {
  const percent = () => Math.round((props.progress ?? 0) * 100)
  return (
    <div class="pc-aic-chip" data-status={props.status} title={props.name} data-component="panacode-attachment-chip">
      <button type="button" class="pc-aic-chipBody" onClick={(event) => props.onOpen?.(event.currentTarget)} disabled={!props.onOpen}>
        <span class="pc-aic-chipGlyph" classList={{ "pc-aic-chipGlyphImage": !!props.thumb }}>
          <Show when={props.thumb} fallback={props.glyph}>
            {(src) => <img class="pc-aic-thumb" src={src()} alt="" />}
          </Show>
        </span>
        <span class="pc-aic-chipText">
          <span class="pc-aic-chipName">{props.name}</span>
          <Show when={props.status === "uploading" || props.meta}>
            <span class="pc-aic-chipMeta" aria-live="off">
              {props.status === "uploading"
                ? (props.uploadingLabel?.(percent()) ?? `Uploading ${percent()}%`)
                : props.meta}
            </span>
          </Show>
        </span>
      </button>
      <button
        type="button"
        class="pc-aic-chipAction"
        aria-label={props.removeLabel}
        onClick={(event) => {
          event.stopPropagation()
          props.onRemove()
        }}
      >
        <Show when={props.status} keyed>
          {(status) => (
            <span class="pc-aic-chipActionGlyph" classList={{ "pc-aic-chipCheck": status === "done" }}>
              {status === "uploading" ? (
                <ProgressRing progress={props.progress ?? 0} />
              ) : status === "done" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              )}
            </span>
          )}
        </Show>
      </button>
    </div>
  )
}
