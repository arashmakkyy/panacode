import { createMemo, Show } from "solid-js"
import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import {
  ContextGroup,
  FileGroup,
  setTimelineOverrides,
  type ActivityGroupPart,
  type ContextGroupProps,
} from "@opencode/session-ui/timeline-next"
import { useData } from "@opencode/session-ui/context"
import { ToolCallGroup, type ToolCallData } from "@panacode/ui/features/tool-call"
import { ToolMark } from "@panacode/ui/features/tool-call/marks"
import { fromOpenCodeTool, type OpenCodeToolLike } from "@panacode/ui/adapters/tool-call"
import { toolWaitingApproval } from "./panacode-tool-state"

const isTool = (part: ActivityGroupPart): part is SessionMessageAssistantTool => part.type === "tool"
const changesFiles = (kind: string) => kind === "edit" || kind === "write" || kind === "patch"

/**
 * Activity groups ("Used 3 tools") render as the Arc Tool Call group, fed by the real tool parts. Thoughts, notices and
 * background events in the same stretch keep the upstream rows; file changes show their diff inside the Output well.
 */
function PanacodeToolGroup(props: ContextGroupProps) {
  const data = useData()
  const tools = createMemo(() => props.parts.filter(isTool))
  const rest = createMemo(() => props.parts.filter((part) => !isTool(part)))
  const byId = createMemo(() => new Map(tools().map((tool) => [tool.id, tool])))
  const calls = createMemo(() =>
    tools().map((tool) =>
      fromOpenCodeTool(tool as unknown as OpenCodeToolLike, {
        root: data.directory,
        approval: toolWaitingApproval(tool.id) && (tool.state.status === "running" || tool.state.status === "streaming"),
        mark: (name) => () => <ToolMark name={name} />,
      }),
    ),
  )
  const renderOutput = (call: ToolCallData) => {
    const tool = byId().get(call.id)
    if (!tool || !changesFiles((call as ToolCallData & { kind: string }).kind)) return undefined
    return (
      <FileGroup
        tools={[tool]}
        fileOpen={(path) => props.fileOpen?.(`${tool.id}:${path}`) ?? true}
        onFileOpenChange={(path, open) => props.onFileOpenChange?.(`${tool.id}:${path}`, open)}
        onSizeChange={props.onSizeChange}
      />
    )
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
        />
      </Show>
    </div>
  )
}

setTimelineOverrides({ ContextGroup: PanacodeToolGroup })
