import { createEffect, createSignal, For, onCleanup, onMount, type JSX } from "solid-js"
import { criticalOmega, stepSpring } from "../motion/spring"
import { prefersReducedMotion } from "../motion/reduced"
import "./segmented-control.css"

export type SegmentOption<T extends string = string> = {
  value: T
  label: JSX.Element
  /** Optional content after the label, such as a badge. Same slot as the Arc reference. */
  accessory?: JSX.Element
}

export interface SegmentedControlProps<T extends string = string> {
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Called when the pointer or focus reaches an option, before it is chosen. */
  onOptionIntent?: (value: T) => void
  class?: string
  "aria-label"?: string
}

/**
 * Arc segmented control. The highlight is one element that springs between options
 * (the reference's shared layout id). Arrow keys, Home and End move the selection.
 * Only the selected option is a tab stop. Overflow fades the track edges.
 */
export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>) {
  let track: HTMLDivElement | undefined
  let highlight: HTMLSpanElement | undefined
  const reduced = prefersReducedMotion()
  const [ready, setReady] = createSignal(false)
  let first = true
  let frame = 0
  let x = 0
  let xv = 0
  let w = 0
  let wv = 0
  const omega = criticalOmega(0.42)

  const selectedIndex = () => Math.max(0, props.options.findIndex((option) => option.value === props.value))

  const targetBox = () => {
    const button = track?.querySelector<HTMLElement>("[aria-pressed='true']")
    if (!track || !button) return
    return { x: button.offsetLeft, w: button.offsetWidth, h: button.offsetHeight, y: button.offsetTop }
  }

  const paint = (left: number, width: number, top: number, height: number) => {
    if (!highlight) return
    highlight.style.transform = `translate(${left}px, ${top}px)`
    highlight.style.width = `${width}px`
    highlight.style.height = `${height}px`
  }

  const kick = () => {
    const next = targetBox()
    if (!next) return
    if (reduced() || !ready()) {
      x = next.x
      w = next.w
      xv = 0
      wv = 0
      paint(next.x, next.w, next.y, next.h)
      setReady(true)
      return
    }
    const tick = () => {
      const box = targetBox()
      if (!box) return
      const nextX = stepSpring({ x, v: xv, target: box.x }, omega, 1 / 60)
      const nextW = stepSpring({ x: w, v: wv, target: box.w }, omega, 1 / 60)
      x = nextX.x
      xv = nextX.v
      w = nextW.x
      wv = nextW.v
      paint(x, w, box.y, box.h)
      const done = Math.abs(x - box.x) < 0.4 && Math.abs(w - box.w) < 0.4 && Math.abs(xv) < 0.4 && Math.abs(wv) < 0.4
      frame = done ? 0 : requestAnimationFrame(tick)
    }
    if (!frame) frame = requestAnimationFrame(tick)
  }

  onMount(() => {
    const node = track
    if (!node) return
    const edges = () => {
      const rest = node.scrollWidth - node.clientWidth - node.scrollLeft
      node.toggleAttribute("data-fade-start", node.scrollLeft > 1)
      node.toggleAttribute("data-fade-end", rest > 1)
    }
    edges()
    node.addEventListener("scroll", edges, { passive: true })
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
      edges()
      kick()
    })
    observer?.observe(node)
    kick()
    onCleanup(() => {
      node.removeEventListener("scroll", edges)
      observer?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    })
  })

  createEffect(() => {
    props.value
    props.options.length
    reduced()
    const node = track
    const button = node?.querySelector<HTMLElement>("[aria-pressed='true']")
    if (node && button && node.scrollWidth > node.clientWidth) {
      const room = 20
      const start = button.offsetLeft - room
      const end = button.offsetLeft + button.offsetWidth + room - node.clientWidth
      const left = node.scrollLeft > start ? start : node.scrollLeft < end ? end : node.scrollLeft
      if (left !== node.scrollLeft) node.scrollTo({ left: Math.max(0, left), behavior: first || reduced() ? "auto" : "smooth" })
    }
    first = false
    kick()
  })

  const move = (event: KeyboardEvent, index: number) => {
    const last = props.options.length - 1
    const target =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1
    if (target < 0) return
    const option = props.options[target]
    if (!option) return
    event.preventDefault()
    props.onChange(option.value)
    track?.querySelector<HTMLElement>(`[data-value="${CSS.escape(option.value)}"]`)?.focus({ preventScroll: true })
  }

  return (
    <div
      role="group"
      aria-label={props["aria-label"]}
      data-component="panacode-segmented"
      data-panacode-primitive="segmented-control"
      class={props.class}
    >
      <div data-slot="segment-track" ref={track}>
        <span data-slot="segment-selection" ref={highlight} aria-hidden="true" />
        <For each={props.options}>
          {(option, index) => (
            <button
              type="button"
              data-value={option.value}
              aria-pressed={props.value === option.value}
              tabIndex={index() === selectedIndex() ? 0 : -1}
              onClick={() => props.onChange(option.value)}
              onKeyDown={(event) => move(event, index())}
              onPointerEnter={() => props.onOptionIntent?.(option.value)}
              onFocus={() => props.onOptionIntent?.(option.value)}
            >
              <span data-slot="segment-label">
                {option.label}
                {option.accessory}
              </span>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
