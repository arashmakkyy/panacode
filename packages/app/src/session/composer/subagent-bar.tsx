import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { modelDisplayName, PANAAI_PROVIDER_ID } from "@/providers/catalog/labels"
import { Slash } from "@opencode/ui/slash"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import { createEffect, createSignal, createUniqueId, For, Match, onCleanup, Show, Switch } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { formatKeybind } from "@/shell/commands/command"
import { formatElapsed } from "./activity-chips"

export type SubagentStatus = "running" | "succeeded" | "failed" | "interrupted"

// A subagent session takes no prompts, so its composer slot is one quiet status line on the timeline's own surface:
// the run's state and duration, the agent, model and variant, and the way back.
export function SubagentBar(props: {
  agent?: string
  model?: { provider?: string; name: string; variant?: string }
  status?: SubagentStatus
  steps?: () => { name: string; status: string }[]
  started: number
  ended?: number
  onBack: () => void
}) {
  const language = useLanguage()
  const [now, setNow] = createSignal(Date.now())
  const [expanded, setExpanded] = createSignal(false)
  const details = createUniqueId()

  // Only what is known shows, with one separator between neighbours.
  const parts = () => [
    ...(props.status ? (["status", "elapsed"] as const) : []),
    ...(props.agent ? (["agent"] as const) : []),
    ...(props.model ? (["model"] as const) : []),
  ]

  createEffect(() => {
    if (props.status !== "running") return

    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    // The timeline scrolls on underneath, so the line keeps its surface and fades the text passing into it.
    <div class="agent-status-block">
      <Show when={expanded() && props.steps}>
        {(steps) => <div id={details} class="agent-status-steps">
          <strong>{language.t("panacode.agent.activity")}</strong>
          <ol><For each={steps()()} fallback={<li>{language.t("panacode.agent.empty")}</li>}>
            {(step) => <li><span>{step.name}</span><span>{step.status}</span></li>}
          </For></ol>
        </div>}
      </Show>
    <div
      data-component="subagent-bar"
      data-agent-status={props.status}
      class="relative flex h-8 w-full min-w-0 items-center gap-2 bg-v2-background-bg-base ps-3 pe-1.5 text-[12px] font-[440] leading-4 tracking-[-0.04px] whitespace-nowrap tabular-nums text-v2-text-text-faint before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-4 before:bg-[linear-gradient(to_top,var(--v2-background-bg-base),transparent)]"
    >
      <Show when={props.status}>
        <span class="flex size-4 shrink-0 items-center justify-center text-v2-icon-icon-faint">
          <Switch>
            <Match when={props.status === "running"}>
              <SessionProgressIndicatorV2 />
            </Match>
            <Match when={props.status === "succeeded"}>
              <Icon name="check" size="small" />
            </Match>
            <Match when={props.status === "failed"}>
              <Icon name="circle-xmark" size="small" />
            </Match>
            <Match when={props.status === "interrupted"}>
              <Icon name="outline-xmark" size="small" />
            </Match>
          </Switch>
        </span>
      </Show>
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <For each={parts()}>
          {(part, index) => (
            <>
              <Show when={index() > 0}>
                <span aria-hidden="true">·</span>
              </Show>
              <Switch>
                <Match when={part === "status" && props.status}>
                  {(status) => <Show when={props.steps} fallback={<span class="subagent-status-label" role="status">{language.t(`session.child.status.${status()}`)}</span>}>
                    <button type="button" class="subagent-status-label" aria-expanded={expanded()} aria-controls={expanded() ? details : undefined}
                      onClick={() => setExpanded((value) => !value)}>{language.t(`session.child.status.${status()}`)} <Icon name="chevron-down" size="small" /></button>
                  </Show>}
                </Match>
                <Match when={part === "elapsed"}>
                  <span class="shrink-0">{formatElapsed((props.ended ?? now()) - props.started, language.t)}</span>
                </Match>
                <Match when={part === "agent" && props.agent}>
                  {(agent) => <span class="shrink-0 capitalize">{agent()}</span>}
                </Match>
                <Match when={part === "model" && props.model}>
                  {(model) => (
                    <span data-slot="subagent-model" class="flex min-w-0">
                      <Show when={model().provider && model().provider?.toLowerCase() !== PANAAI_PROVIDER_ID}>
                        <span class="shrink-0">{model().provider}</span>
                        <Slash gap={4} />
                        <span class="sr-only">{" / "}</span>
                      </Show>
                      <span class="truncate">{modelDisplayName(model().provider?.toLowerCase() ?? "", model().name)}</span>
                      {/* Like the message metadata: the variant follows the name, dimmer, with no separator. */}
                      <Show when={model().variant !== "default" && model().variant}>
                        {(variant) => (
                          <>
                            <span class="sr-only">{" "}</span>
                            <span class="ms-1 shrink-0 capitalize opacity-[0.66]">{variant()}</span>
                          </>
                        )}
                      </Show>
                    </span>
                  )}
                </Match>
              </Switch>
            </>
          )}
        </For>
      </div>
      <Button type="button" variant="ghost-faint" size="small" class="shrink-0 gap-1.5 px-1.5" onClick={props.onBack}>
        {language.t("session.child.backToParent")}
        <span class="hidden sm:block">
          <Keybind keys={[formatKeybind("esc", language.t)]} variant="neutral" />
        </span>
      </Button>
    </div>
    </div>
  )
}
