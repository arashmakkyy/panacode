import type { Platform } from "@opencode/app/desktop"
import { BrandMark, BrandWordmark, brand } from "@panacode/ui/brand"
import { onMount } from "solid-js"
import "./splash.css"

// The splash renders the active brand pack from @panacode/ui/brand, so swapping
// the pack (script/panacode-brand-apply.ts) re-skins it with no edits here.
function SplashBrand(props: { large?: boolean }) {
  return (
    <div data-slot="startup-brand" data-size={props.large ? "large" : "default"}>
      <div data-slot="startup-mark">
        <BrandMark size={props.large ? 76 : 60} />
      </div>
      <div data-slot="startup-wordmark" aria-label={brand.name}>
        <BrandWordmark height={props.large ? 34 : 28} />
      </div>
      <p data-slot="startup-tagline">{brand.tagline}</p>
      <div data-slot="startup-progress" aria-hidden="true">
        <span />
      </div>
    </div>
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
    // No wordmark draw animation: the brand lockup shows immediately.
    props.onDrawStart()
    props.onDrawEnd()
  })

  return (
    <div
      data-component={props.firstLaunch ? "first-launch-splash" : "startup-splash"}
      data-deep={props.deep ? "" : undefined}
      class="h-dvh w-screen"
    >
      <SplashBrand large={props.firstLaunch} />
    </div>
  )
}
