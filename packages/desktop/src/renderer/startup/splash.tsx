import type { Platform } from "@opencode/app/desktop"
import { onMount, Show } from "solid-js"
import "./splash.css"

function BrandMark(props: { large?: boolean }) {
  return (
    <p
      data-slot="startup-brand"
      classList={{
        "text-20-medium tracking-tight": true,
        "opacity-90": !!props.large,
      }}
      style={{
        "font-size": props.large ? "32px" : undefined,
        "user-select": "text",
        "-webkit-user-select": "text",
        cursor: "text",
        color: "var(--text-strong, #ededed)",
        margin: "0",
      }}
    >
      Panacode
    </p>
  )
}

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
          style={{
            "background-color": props.deep
              ? "var(--v2-background-bg-deep, #080808)"
              : "var(--v2-background-bg-base, #161616)",
          }}
        >
          <BrandMark />
        </div>
      }
    >
      <div
        data-component="first-launch-splash"
        data-drawing="running"
        class="h-dvh w-screen flex flex-col items-center justify-center bg-v2-background-bg-base"
        style={{ "background-color": "var(--v2-background-bg-base, #161616)" }}
      >
        <BrandMark large />
      </div>
    </Show>
  )
}
