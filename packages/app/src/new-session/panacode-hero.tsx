import { Icon } from "@opencode/ui/icon"
import { ComposerHero, SuggestionChips, type ComposerSuggestion } from "@panacode/ui/features/ai-composer"
import { useLanguage } from "@/runtime/i18n/language"

/** Panacode empty state for a new session: brand hero above the real composer. */
export function PanacodeNewSessionHero() {
  const language = useLanguage()
  return <ComposerHero title={language.t("panacode.home.title")} />
}

/** Suggestion pills under the composer. A pick types its prompt into the real composer editor and focuses it. */
export function PanacodeNewSessionSuggestions(props: { onPick?: () => void }) {
  const language = useLanguage()
  const items = (): ComposerSuggestion[] => [
    {
      id: "explain",
      label: language.t("panacode.suggestion.explain"),
      prompt: language.t("panacode.suggestion.explain.prompt"),
      icon: <Icon name="magnifying-glass" size="small" />,
    },
    {
      id: "bug",
      label: language.t("panacode.suggestion.bug"),
      prompt: language.t("panacode.suggestion.bug.prompt"),
      icon: <Icon name="code-slash" size="small" />,
    },
    {
      id: "tests",
      label: language.t("panacode.suggestion.tests"),
      prompt: language.t("panacode.suggestion.tests.prompt"),
      icon: <Icon name="flask" size="small" />,
    },
  ]
  return (
    <SuggestionChips
      items={items()}
      onPick={(item) => {
        const editor = document.querySelector<HTMLElement>(
          '[data-component="new-session"] [data-component="composer-editor"][contenteditable="true"]',
        )
        if (!editor) return
        editor.focus()
        document.execCommand("selectAll")
        document.execCommand("insertText", false, item.prompt)
        props.onPick?.()
      }}
    />
  )
}
