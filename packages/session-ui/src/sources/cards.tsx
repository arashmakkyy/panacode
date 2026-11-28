import { createSignal, For, Show } from "solid-js"
import { useI18n } from "@opencode/ui/context/i18n"
import { SiteIcon } from "./site-icon"
import { sourcesExperiment } from "./experiment"
import type { TurnSources } from "./sources"
import "./cards.css"

export function SourceCards(props: { sources: TurnSources; open: (url: string) => void }) {
  const i18n = useI18n()
  const [expanded, setExpanded] = createSignal(false)
  const visible = () => (expanded() ? props.sources.sources : props.sources.sources.slice(0, 3))

  return (
    <Show when={props.sources.sources.length}>
      <section class="source-cards" aria-label={i18n.t("ui.sources.title")}>
        <For each={visible()}>
          {(source, i) => (
            <a
              class="source-card"
              href={source.url}
              title={source.title || source.url}
              onClick={(event) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return
                event.preventDefault()
                props.open(source.url)
              }}
            >
              <span>
                <SiteIcon site={source.site} host={source.host} mode={sourcesExperiment.icons} />
                <bdi>{source.site}</bdi>
                <small>{i() + 1}</small>
              </span>
              <strong>{source.title || source.site}</strong>
            </a>
          )}
        </For>
        <Show when={props.sources.sources.length > 3}>
          <button
            type="button"
            class="source-card-overflow"
            aria-expanded={expanded()}
            onClick={() => setExpanded((v) => !v)}
          >
            <Show when={!expanded()}>
              <span class="source-card-stack" aria-hidden="true">
                <For each={props.sources.sources.slice(3, 6)}>
                  {(source) => <SiteIcon site={source.site} host={source.host} mode={sourcesExperiment.icons} />}
                </For>
              </span>
            </Show>
            {expanded()
              ? i18n.t("ui.sources.fewer")
              : i18n.t("ui.sources.more", { count: props.sources.sources.length - 3 })}
          </button>
        </Show>
      </section>
    </Show>
  )
}
