import { usePlatform } from "@/runtime/platform/platform"
import { createMemo, Show } from "solid-js"
import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import {
  ContextGroup,
  setTimelineOverrides,
  type ActivityGroupPart,
  type ContextGroupProps,
} from "@opencode/session-ui/timeline-next"
import { useData } from "@opencode/session-ui/context"
import { ToolCallGroup, type ToolCallData, type ToolCallLabels } from "@panacode/ui/features/tool-call"
import { ToolMark } from "@panacode/ui/features/tool-call/marks"
import { fromOpenCodeTool, toolKind, type ToolCallCopy } from "@panacode/ui/adapters/tool-call"
import { useLanguage } from "@/runtime/i18n/language"
import { PanacodeCodeSuggestions, toolFileChanges } from "./panacode-code-suggestion"
import { toolWaitingApproval } from "./panacode-tool-state"

const isTool = (part: ActivityGroupPart): part is SessionMessageAssistantTool => part.type === "tool"

const nativeTools = new Set(["shell", "subagent", "question", "execute"])

const changesFiles = (kind: string) => kind === "edit" || kind === "write" || kind === "patch"

/**
 * Activity groups ("Used 3 tools") render as the Arc Tool Call group, fed by the real tool parts. Thoughts, notices and
 * background events in the same stretch keep the upstream rows; file changes show their diff inside the Output well.
 */
function useToolCopy() {
  const language = useLanguage()
  const t = language.t

  const copy: ToolCallCopy = {
    name: (kind, raw) => t(`panacode.tool.${kind}.name`, { name: raw }),
    title: (kind, status, subject, raw) => {
      const base = t(`panacode.tool.${kind}.${status}`, { name: raw })

      return subject ? `${base} ${subject}` : base
    },
    exitCode: (code) => t("panacode.tool.exit", { code }),
    timedOut: t("panacode.tool.timedOut"),
    stopped: t("panacode.tool.stopped"),
  }

  const labels = (): Partial<ToolCallLabels> => ({
    input: t("panacode.tool.input"),
    output: t("panacode.tool.output"),
    copy: t("panacode.tool.copy"),
    copied: t("panacode.tool.copied"),
    manualCopy: t("panacode.clipboard.manual"),
    close: t("common.close"),
    copyFailed: t("panacode.tool.copyFailed"),
    allow: t("panacode.tool.allow"),
    deny: t("panacode.tool.deny"),
    retry: t("panacode.tool.retry"),
    notRun: t("panacode.tool.notRun"),
    showLess: t("panacode.tool.showLess"),
    showMore: (count, unit) => t(`panacode.tool.showMore.${unit}`, { count }),
    filterJson: t("panacode.tool.filterJson"),
    noJsonResults: t("panacode.tool.noJsonResults"),
    empty: {
      running: t("panacode.tool.empty.running"),
      success: t("panacode.tool.empty.success"),
      error: t("panacode.tool.empty.success"),
      approval: t("panacode.tool.empty.approval"),
      denied: t("panacode.tool.empty.denied"),
    },
    status: (status, summary, duration, message) => {
      if (status === "success") return [t("panacode.tool.status.done"), summary, duration].filter(Boolean).join(", ")

      if (status === "error") return [t("panacode.tool.status.failed"), message].filter(Boolean).join(". ")

      if (status === "approval") return [t("panacode.tool.status.approval"), message].filter(Boolean).join(". ")

      return t(`panacode.tool.status.${status}`)
    },
    used: (count, working) => language.plural(working ? "panacode.tool.using" : "panacode.tool.used", count),
    count: (count, unit) => t(`panacode.tool.count.${unit}`, { count }),
  })

  return { copy, labels }
}

function PanacodeToolGroup(props: ContextGroupProps) {
  const data = useData()
  const i18n = useToolCopy()
  const platform = usePlatform()
  const tools = createMemo(() => props.parts.filter(isTool))

  // The native group preserves interleaved events, child-session links and rich tool results.
  const native = () => props.parts.some((part) =>
    !isTool(part) || nativeTools.has(toolKind(part.name)) ||
    ("content" in part.state && part.state.content?.some((item) => item.type !== "text")),
  )

  const byId = createMemo(() => new Map(tools().map((tool) => [tool.id, tool])))

  const calls = createMemo(() =>
    (native() ? [] : tools()).map((tool) =>
      fromOpenCodeTool(tool, {
        root: data.directory,
        copy: i18n.copy,
        approval: toolWaitingApproval(tool.id) && (tool.state.status === "running" || tool.state.status === "streaming"),
        mark: (name) => () => <ToolMark name={name} />,
      }),
    ),
  )

  const renderOutput = (call: ToolCallData) => {
    const tool = byId().get(call.id)

    if (!tool || !changesFiles(toolKind(tool.name))) return undefined

    if (tool.state.status !== "completed") return undefined

    return <PanacodeCodeSuggestions tool={tool} title={call.title} />
  }

  return (
    <Show when={!native()} fallback={<ContextGroup {...props} />}>
      <div data-component="panacode-activity" data-timeline-part-ids={tools().map((tool) => tool.id).join(",")}>
        <ToolCallGroup
          nativeCopy={platform.writeClipboardText}
          calls={calls()}
          open={props.open}
          autoCollapse={false}
          onOpenChange={(open) => {
            props.onOpenChange(open)
            props.onSizeChange?.()
          }}
          callOpen={(id) => {
            const tool = byId().get(id)

            return props.toolOpen?.(id) ?? (tool && props.toolDefaultOpen?.(tool))
          }}
          onCallOpenChange={(id, open) => {
            props.onToolOpenChange?.(id, open)
            props.onSizeChange?.()
          }}
          renderOutput={renderOutput}
          hasOutput={(call) => {
            const tool = byId().get(call.id)

            return !!tool && changesFiles(toolKind(tool.name)) && toolFileChanges(tool).length > 0
          }}
          labels={i18n.labels()}
        />
      </div>
    </Show>
  )
}

setTimelineOverrides({ ContextGroup: PanacodeToolGroup })
