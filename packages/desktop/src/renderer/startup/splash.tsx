import { useLanguage, type Platform } from "@opencode/app/desktop"
import { BrandMark, BrandWordmark, brand } from "@panacode/ui/brand"
import { For, Show, onMount } from "solid-js"
import type { OnboardingState } from "../onboarding/machine"
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
  stage?: OnboardingState["status"]
  platform: Platform
  drawingPaused: boolean
  onDrawStart: () => void
  onDrawEnd: () => void
}) {
  const language = useLanguage()
  const labels = ["panacode.startup.restore", "panacode.startup.project", "panacode.startup.draft"] as const

  const progress = () => {
    switch (props.stage) {
      case "finishing":
      case "seeding": return 1
      case "drafting": return 2
      case "done": return 3
      default: return 0
    }
  }

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
      <Show when={props.firstLaunch && props.stage && props.stage !== "disposed"}>
        <ol class="startup-checklist" aria-label={language.t("panacode.welcome.title")}>
          <For each={labels}>{(label, i) => <li aria-current={i() === progress() ? "step" : undefined} data-done={i() < progress()}>
            <i aria-hidden="true">{i() < progress() ? "✓" : ""}</i>{language.t(label)}
          </li>}</For>
        </ol>
      </Show>
    </div>
  )
}
