import { createEffect, createSignal, on, onCleanup, Show, type JSX } from "solid-js"
import { prefersReducedMotion } from "./reduced"

/**
 * Height + opacity presence, the Solid stand-in for Arc's
 * `<AnimatePresence>{open && <motion.div initial={{height:0,opacity:0}} animate={{height:"auto",opacity:1}} exit=… />}`.
 * Height runs on the Arc smooth spring (CSS linear() from @panacode/ui/motion), opacity on the fast duration.
 * Content stays mounted while it closes, then unmounts.
 */
export function Collapse(props: {
  open: boolean
  children: JSX.Element
  class?: string
  id?: string
  /** "smooth" for panels (default), "snappy" for small rows. */
  spring?: "smooth" | "snappy" | "morph"
  /** Skip the enter animation on the first render (Arc `initial={false}`). */
  appear?: boolean
  ref?: (el: HTMLDivElement) => void
}) {
  const reduced = prefersReducedMotion()
  const [mounted, setMounted] = createSignal(props.open)
  let el: HTMLDivElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const spring = () => props.spring ?? "smooth"
  const transition = () =>
    `height var(--spring-${spring()}-duration, 400ms) var(--spring-${spring()}, ease), opacity var(--duration-fast, 160ms) var(--ease-standard, ease)`

  const run = (opening: boolean) => {
    if (!el) return
    clearTimeout(timer)
    if (reduced()) {
      el.style.height = opening ? "" : "0px"
      el.style.opacity = opening ? "" : "0"
      if (!opening) setMounted(false)
      return
    }
    const from = el.getBoundingClientRect().height
    const to = opening ? el.scrollHeight : 0
    el.style.transition = "none"
    el.style.height = `${from}px`
    el.style.opacity = opening ? (from === 0 ? "0" : el.style.opacity) : "1"
    void el.offsetHeight
    el.style.transition = transition()
    el.style.height = `${to}px`
    el.style.opacity = opening ? "1" : "0"
    const settle = () => {
      if (!el) return
      if (opening) {
        el.style.height = ""
        el.style.transition = ""
      } else setMounted(false)
    }
    el.addEventListener("transitionend", function end(event) {
      if (event.target !== el || event.propertyName !== "height") return
      el?.removeEventListener("transitionend", end)
      settle()
    })
    // transitionend never fires when nothing changed; a fallback keeps state honest.
    timer = setTimeout(settle, 900)
  }

  createEffect(
    on(
      () => props.open,
      (open, prev) => {
        if (open) {
          setMounted(true)
          if (prev === undefined && props.appear !== true) return
          queueMicrotask(() => {
            if (el) {
              el.style.height = "0px"
              el.style.opacity = "0"
            }
            requestAnimationFrame(() => run(true))
          })
          return
        }
        if (prev === undefined) return
        run(false)
      },
    ),
  )
  onCleanup(() => clearTimeout(timer))

  return (
    <Show when={mounted()}>
      <div
        ref={(node) => {
          el = node
          props.ref?.(node)
        }}
        id={props.id}
        class={props.class}
        style={{ overflow: "hidden" }}
      >
        {props.children}
      </div>
    </Show>
  )
}
