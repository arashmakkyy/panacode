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
import { fromOpenCodeTool, type OpenCodeToolLike, type ToolCallCopy } from "@panacode/ui/adapters/tool-call"
import { useLanguage } from "@/runtime/i18n/language"
import { PanacodeCodeSuggestions, toolFileChanges } from "./panacode-code-suggestion"
import { toolWaitingApproval } from "./panacode-tool-state"

const isTool = (part: ActivityGroupPart): part is SessionMessageAssistantTool => part.type === "tool"
const changesFiles = (kind: string) => kind === "edit" || kind === "write" || kind === "patch"

/**
 * Activity groups ("Used 3 tools") render as the Arc Tool Call group, fed by the real tool parts. Thoughts, notices and
 * background events in the same stretch keep the upstream rows; file changes show their diff inside the Output well.
 */
function useToolCopy() {
  const language = useLanguage()
  const t = (key: string, params?: Record<string, string | number>) => language.t(key as never, params as never) as string
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
    copyFailed: t("panacode.tool.copyFailed"),
    allow: t("panacode.tool.allow"),
    deny: t("panacode.tool.deny"),
    retry: t("panacode.tool.retry"),
    notRun: t("panacode.tool.notRun"),
    showLess: t("panacode.tool.showLess"),
    showMore: (count, unit) => t(`panacode.tool.showMore.${unit}`, { count }),
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
    used: (count, working) => t(`panacode.tool.${working ? "using" : "used"}.${count === 1 ? "one" : "other"}`, { count }),
    count: (count, unit) => t(`panacode.tool.count.${unit}`, { count }),
  })
  return { copy, labels }
}

function PanacodeToolGroup(props: ContextGroupProps) {
  const data = useData()
  const i18n = useToolCopy()
  const tools = createMemo(() => props.parts.filter(isTool))
  const rest = createMemo(() => props.parts.filter((part) => !isTool(part)))
  const byId = createMemo(() => new Map(tools().map((tool) => [tool.id, tool])))
  const calls = createMemo(() =>
    tools().map((tool) =>
      fromOpenCodeTool(tool as unknown as OpenCodeToolLike, {
        root: data.directory,
        copy: i18n.copy,
        approval: toolWaitingApproval(tool.id) && (tool.state.status === "running" || tool.state.status === "streaming"),
        mark: (name) => () => <ToolMark name={name} />,
      }),
    ),
  )
  const renderOutput = (call: ToolCallData) => {
    const tool = byId().get(call.id)
    if (!tool || !changesFiles((call as ToolCallData & { kind: string }).kind)) return undefined
    if (tool.state.status !== "completed") return undefined
    return <PanacodeCodeSuggestions tool={tool} title={call.title} />
  }

  return (
    <div data-component="panacode-activity" class="contents">
      <Show when={rest().length > 0}>
        <ContextGroup {...props} parts={rest()} />
      </Show>
      <Show when={calls().length > 0}>
        <ToolCallGroup
          calls={calls()}
          defaultOpen={props.open || undefined}
          onOpenChange={(open) => {
            props.onOpenChange(open)
            props.onSizeChange?.()
          }}
          renderOutput={renderOutput}
          hasOutput={(call) => {
            const tool = byId().get(call.id)
            return !!tool && changesFiles((call as ToolCallData & { kind: string }).kind) && toolFileChanges(tool).length > 0
          }}
          labels={i18n.labels()}
        />
      </Show>
    </div>
  )
}

setTimelineOverrides({ ContextGroup: PanacodeToolGroup })
