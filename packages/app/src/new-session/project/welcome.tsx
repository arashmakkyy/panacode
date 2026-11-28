import { createSignal, For } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { PromptProjectAddButton, type PromptProjectController } from "./selector"
import "./welcome.css"

const steps = ["folder", "files", "model", "ready"] as const

const art = [
  "M7 15h12l4 4h18v18H7z M11 23h26",
  "M11 12h18l7 7v20H11z M27 12v9h9 M16 26h14 M16 31h10",
  "M14 16h20v18H14z M19 12v4 M28 12v4 M19 34v4 M28 34v4 M9 21h5 M34 21h5 M9 29h5 M34 29h5 M19 24h2 M27 24h2",
  "M24 10l5 4 6 1 1 6 3 5-4 5-1 5-6 1-4 3-5-4-5-1-1-6-3-4 4-5 1-5 6-1z M18 25l4 4 8-9",
] as const

export function ProjectWelcome(props: { controller: PromptProjectController }) {
  const language = useLanguage()
  const [index, setIndex] = createSignal(0)

  return (
    <section class="project-welcome" aria-label={language.t("panacode.welcome.title")}>
      <div class="project-welcome-art" aria-hidden="true">
        <svg
          viewBox="0 0 48 48"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <For each={art}>{(path, i) => <path d={path} data-visible={i() === index()} />}</For>
        </svg>
      </div>
      <div class="project-welcome-body">
        <span aria-live="polite">
          <strong>{language.t(`panacode.welcome.${steps[index()]}`)}</strong>
          <span>{language.t(`panacode.welcome.${steps[index()]}.detail`)}</span>
        </span>
        <PromptProjectAddButton controller={props.controller} />
      </div>
      <div class="project-welcome-steps">
        <button
          type="button"
          disabled={index() === 0}
          aria-label={language.t("panacode.welcome.previous")}
          onClick={() => setIndex((n) => n - 1)}
        >
          <Icon name="chevron-left" size="small" />
        </button>
        <For each={steps}>
          {(step, i) => (
            <button
              type="button"
              aria-label={language.t(`panacode.welcome.${step}`)}
              aria-current={i() === index() ? "step" : undefined}
              onClick={() => setIndex(i())}
            >
              <i />
            </button>
          )}
        </For>
        <button
          type="button"
          disabled={index() === steps.length - 1}
          aria-label={language.t("panacode.welcome.next")}
          onClick={() => setIndex((n) => n + 1)}
        >
          <Icon name="chevron-right" size="small" />
        </button>
      </div>
    </section>
  )
}
