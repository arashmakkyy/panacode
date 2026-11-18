import type { Platform } from "@opencode/app/desktop"
import { onMount, Show } from "solid-js"
import "./splash.css"

export function LoadingSplash(props: {
  deep: boolean
  firstLaunch: boolean
  platform: Platform
  drawingPaused: boolean
  onDrawStart: () => void
  onDrawEnd: () => void
}) {
  onMount(() => {
    // Skip OpenCode wordmark draw animation — show Panacode immediately.
    props.onDrawStart()
    props.onDrawEnd()
  })

  return (
    <Show
      when={props.firstLaunch}
      fallback={
        <div
          data-component="startup-splash"
          class="h-dvh w-screen flex flex-col items-center justify-center gap-3"
          classList={{
            "bg-v2-background-bg-deep": props.deep,
            "bg-v2-background-bg-base": !props.deep,
          }}
        >
          <div class="text-20-medium text-v2-text-text-strong tracking-tight">Panacode</div>
        </div>
      }
    >
      <div
        data-component="first-launch-splash"
        data-drawing="running"
        aria-hidden="true"
        class="h-dvh w-screen flex flex-col items-center justify-center bg-v2-background-bg-base"
      >
        <div class="text-20-medium text-v2-text-text-strong tracking-tight opacity-80" style={{ "font-size": "32px" }}>
          Panacode
        </div>
      </div>
    </Show>
  )
}
