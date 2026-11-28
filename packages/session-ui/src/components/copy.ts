import { writeClipboard } from "@opencode/ui/clipboard"

export { writeClipboard } from "@opencode/ui/clipboard"

import { createMemo, createSignal, onCleanup, untrack } from "solid-js"
import {
  INITIAL_COPY_FEEDBACK_STATE,
  transitionCopyFeedback,
  viewCopyFeedback,
  type CopyFeedbackEffect,
  type CopyFeedbackEvent,
} from "./copy-machine"

/** "Copied" feedback for one copy button. Owner cleanup clears the timer and ignores a write still in flight. */
export function createCopyFeedback(options?: {
  write: (text: string) => Promise<boolean | void>
  onError: () => void
}) {
  const write = options?.write ?? writeClipboard

  const [state, setState] = createSignal(INITIAL_COPY_FEEDBACK_STATE)
  let timer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: CopyFeedbackEvent) => {
    const next = transitionCopyFeedback(untrack(state), event)

    if (next.state === untrack(state)) return
    setState(next.state)

    if (event.type === "copy.failed") options?.onError()
    next.effects.forEach(run)
  }

  const run = (effect: CopyFeedbackEffect) => {
    if (effect.type === "clear-reset") {
      clearTimeout(timer)
      timer = undefined

      return
    }

    if (effect.type === "schedule-reset") {
      timer = setTimeout(() => dispatch({ type: "reset.due", attempt: effect.attempt }), effect.delayMs)

      return
    }

    void Promise.try(() => write(effect.text)).then(
      (written) => dispatch({ type: written === false ? "copy.failed" : "copy.succeeded", attempt: effect.attempt }),
      () => dispatch({ type: "copy.failed", attempt: effect.attempt }),
    )
  }

  onCleanup(() => dispatch({ type: "disposed" }))
  const view = createMemo(() => viewCopyFeedback(state()))

  return {
    copied: () => view().copied,
    copy: (text: string) => dispatch({ type: "copy.requested", text }),
  }
}
