import { createSignal, For } from "solid-js"
import { Tabs } from "@opencode/ui/tabs"
import { Icon } from "@opencode/ui/icon"
import { ComposerHero } from "@panacode/ui/features/ai-composer"
import { useLanguage } from "@/runtime/i18n/language"
import "./starter-prompts.css"

export function PanacodeNewSessionHero() {
  const language = useLanguage()

  return <ComposerHero title={language.t("panacode.home.title")} />
}

const categories = [
  { id: "code", icon: "code-slash", prompts: ["explain", "bug", "tests", "refactor", "trace"] },
  { id: "analyze", icon: "magnifying-glass", prompts: ["deps", "changes", "latency", "coverage", "errors"] },
  { id: "plan", icon: "outline-list-changelog", prompts: ["feature", "migration", "release", "split", "verify"] },
  { id: "write", icon: "file-document", prompts: ["readme", "notes", "guide", "example", "handoff"] },
] as const

export function PanacodeNewSessionSuggestions(props: { onPick: (prompt: string) => void }) {
  const language = useLanguage()
  const [offset, setOffset] = createSignal(0)
  const [category, setCategory] = createSignal<string>("code")

  return (
    <section class="starter-prompts" aria-label={language.t("panacode.starters.title")}>
      <Tabs variant="pill" value={category()} onChange={(next) => {
        setCategory(next)
        setOffset(0)
      }}>
        <div class="starter-toolbar">
          <Tabs.List aria-label={language.t("panacode.starters.title")}>
            <For each={categories}>{(group) => (
              <Tabs.Trigger value={group.id}>{language.t(`panacode.starters.${group.id}`)}</Tabs.Trigger>
            )}</For>
          </Tabs.List>
          <button class="starter-shuffle" type="button" title={language.t("panacode.starters.shuffle")}
            aria-label={language.t("panacode.starters.shuffle")} onClick={() => setOffset((n) => n + 1)}>
            <Icon name="refresh" size="small" />
          </button>
        </div>
        <span class="sr-only" role="status">{offset() > 0 ? language.t("panacode.starters.shuffled", { count: offset() }) : ""}</span>
        <For each={categories}>{(group) => (
          <Tabs.Content value={group.id}>
            <div class="starter-grid">
              <For each={Array.from({ length: 4 }, (_, i) => group.prompts[(offset() + i) % group.prompts.length]!)}>{(id) => (
                <button type="button" class="starter-card" data-suggestion={id}
                  onClick={() => props.onPick(language.t(`panacode.suggestion.${id}.prompt`))}>
                  <span class="starter-card-mark" aria-hidden="true"><Icon name={group.icon} size="small" /></span>
                  <span class="starter-card-copy">
                    <strong>{language.t(`panacode.suggestion.${id}`)}</strong>
                    <span>{language.t(`panacode.suggestion.${id}.prompt`)}</span>
                  </span>
                </button>
              )}</For>
            </div>
          </Tabs.Content>
        )}</For>
      </Tabs>
    </section>
  )
}
