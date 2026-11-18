import { createMemo, Show } from "solid-js"
import {
  setTimelineOverrides,
  type TextFooterProps,
  type ThoughtRowProps,
} from "@opencode/session-ui/timeline-next"
import {
  ChatReasoning,
  ChatReplyActions,
  ChatStatusLine,
  ChatTools,
  type ChatLabels,
  type ChatTool,
} from "@panacode/ui/features/ai-chat"
import { BrandMark } from "@panacode/ui/brand"
import { useLanguage } from "@/runtime/i18n/language"
import { useCommand } from "@/shell/commands/command"

type Translate = (key: string, params?: Record<string, string | number>) => string

function useChatText() {
  const language = useLanguage()
  const t: Translate = (key, params) => language.t(key as never, params as never) as string
  const labels = (): Partial<ChatLabels> => ({
    thinking: t("panacode.chat.thinking"),
    thoughtFor: (seconds) => t("panacode.chat.thoughtFor", { seconds }),
    thoughtBriefly: t("panacode.chat.thoughtBriefly"),
    copy: t("panacode.chat.copy"),
    copied: t("panacode.chat.copied"),
    copyFailed: t("panacode.chat.copyFailed"),
    retry: t("panacode.chat.retry"),
    stopped: t("panacode.chat.stopped"),
    stoppedBeforeAnswer: t("panacode.chat.stoppedBeforeAnswer"),
    failed: t("panacode.chat.failed"),
    searches: t("panacode.chat.searches"),
    sources: t("panacode.chat.sources"),
    result: t("panacode.chat.result"),
  })
  return { t, labels, locale: () => language.locale() }
}

const modelMark = () => <BrandMark size={16} />

/** Arc reasoning head in place of the upstream thought row. Keeps the reasoning-part hook for tests. */
function PanacodeThought(props: ThoughtRowProps) {
  const text = useChatText()
  const seconds = () => {
    const time = props.content.time
    if (time?.completed === undefined) return undefined
    return Math.max(1, Math.round((time.completed - time.created) / 1000))
  }
  return (
    <div data-component="reasoning-part" data-timeline-part-id={props.id}>
      <ChatReasoning
        mark={modelMark}
        thinking={props.streaming}
        thoughtFor={props.streaming ? undefined : seconds()}
        hasText={!!props.content.text.trim()}
        open={props.open}
        defaultOpen={props.defaultOpen}
        onOpenChange={(open) => {
          props.onOpenChange?.(open)
          props.onContentRendered?.()
        }}
        labels={text.labels()}
      >
        {props.content.text}
      </ChatReasoning>
    </div>
  )
}

/** The turn's web searches and page reads as Arc tool chips with their sources. */
function sourceTools(sources: TextFooterProps["sources"], t: Translate): ChatTool[] {
  if (!sources) return []
  return sources.steps.map((step): ChatTool => {
    const status = step.status === "completed" ? "done" : step.status
    if (step.type === "search")
      return {
        id: step.id,
        name: t("panacode.chat.searched"),
        activeName: t("panacode.chat.searching"),
        status,
        summary: step.results.length ? t("panacode.chat.sourceCount", { count: step.results.length }) : undefined,
        icon: "search",
        input: [step.query],
        sources: step.results.map((result) => ({ title: result.title ?? result.site, url: result.url })),
      }
    return {
      id: step.id,
      name: t("panacode.chat.read", { site: step.site }),
      activeName: t("panacode.chat.reading", { site: step.site }),
      status,
      icon: "file",
      sources: step.status === "error" ? [] : [{ title: step.title ?? step.site, url: step.url }],
    }
  })
}

/** Copy text without markdown emphasis and code ticks, as Arc copies a reply. */
const plain = (text: string) =>
  text
    .replace(/\*\*/g, "")
    .replace(/`(?!``)/g, "")
    .trim()

function PanacodeReplyFooter(props: TextFooterProps) {
  const text = useChatText()
  const command = useCommand()
  const tools = createMemo(() => sourceTools(props.sources, text.t))
  const duration = createMemo(() => {
    const ms =
      props.turnDurationMs ??
      (props.message.time.completed !== undefined ? props.message.time.completed - props.message.time.created : -1)
    if (!(ms >= 0)) return ""
    const total = Math.round(ms / 1000)
    const format = new Intl.NumberFormat(text.locale())
    return total < 60
      ? text.t("panacode.chat.seconds", { count: format.format(total) })
      : text.t("panacode.chat.minutesSeconds", { minutes: format.format(Math.floor(total / 60)), seconds: format.format(total % 60) })
  })
  const speed = createMemo(() =>
    props.turnTokensPerSecond === undefined
      ? ""
      : text.t("panacode.chat.speed", {
          value: new Intl.NumberFormat(text.locale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(
            props.turnTokensPerSecond,
          ),
        }),
  )
  const meta = () => [props.message.model.id, duration(), speed()].filter(Boolean).join(" · ")

  const retry = async () => {
    await props.onRetry?.()
    command.trigger("prompt.submit")
  }

  return (
    <div class="pc-ac-footer" data-panacode-last-turn={props.onRetry ? "" : undefined}>
      <Show when={props.interrupted}>
        <ChatStatusLine answered={!!props.text.trim()} labels={text.labels()} />
      </Show>
      <Show when={tools().length}>
        <ChatTools tools={tools()} labels={text.labels()} />
      </Show>
      <ChatReplyActions
        copyText={plain(props.text)}
        onRetry={props.onRetry ? () => void retry() : undefined}
        meta={meta() || undefined}
        labels={text.labels()}
      />
    </div>
  )
}

setTimelineOverrides({ ThoughtRow: PanacodeThought, TextFooter: PanacodeReplyFooter })
