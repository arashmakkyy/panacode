import { createMemo, createSignal, Match, Switch } from "solid-js"
import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { createTwoFilesPatch } from "diff"
import { AgentRun, type AgentRunLabels, type AgentRunState, type DiffLine, type ProposedChange } from "@panacode/ui/features/agent-run"
import {
  changedFile,
  patchToLines,
  runChecks,
  runSteps,
  runToolKind,
  type RunContentLike,
  type RunStepCopy,
} from "@panacode/ui/adapters/agent-run"
import { BrandMark } from "@panacode/ui/brand"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { toolWaitingApproval } from "./panacode-tool-state"
import { PanacodeOrchestrator } from "./panacode-orchestrator"
import { toolFileChanges } from "./panacode-code-suggestion"
import type { SessionRequestModel } from "./requests/model"

// This window's notes sent back with rejections, by tool call id, and runs the user closed, by user message id.
const [notes, setNotes] = createSignal<Record<string, string>>({})
const [dismissed, setDismissed] = createSignal<ReadonlySet<string>>(new Set())

const interrupted = (error: { type: string } | undefined) => {
  const type = error?.type.toLowerCase()
  return !!type && (type.includes("abort") || type.includes("interrupt"))
}

/** The patch a pending edit or write would apply, from the tool input (nothing is written yet). */
function pendingChange(tool: SessionMessageAssistantTool, root: string): ProposedChange | undefined {
  const input = (tool.state.input && typeof tool.state.input === "object" ? tool.state.input : {}) as Record<string, unknown>
  const path = (input.filePath ?? input.path) as string | undefined
  if (!path) return undefined
  const rel = path.startsWith(root.replace(/\/+$/, "") + "/") ? path.slice(root.replace(/\/+$/, "").length + 1) : path
  const patch =
    typeof input.oldString === "string" && typeof input.newString === "string"
      ? createTwoFilesPatch(rel, rel, input.oldString, input.newString)
      : typeof input.content === "string"
        ? createTwoFilesPatch(rel, rel, "", input.content)
        : undefined
  if (!patch) return undefined
  return {
    id: tool.id,
    summary: "",
    files: [{ path: rel, status: typeof input.content === "string" ? "added" : "modified", lines: patchToLines(patch) }],
  }
}

/**
 * The Arc Agent Run card above the composer, built from the session's latest turn: its tool calls and reasoning are
 * the steps, a pending edit permission is the review step (Approve replies once; Reject sends the note back with the
 * rejection), and a finished turn folds into the reply, the files it changed and the commands it ran.
 */
export function PanacodeAgentRun(props: {
  sessionID: string | undefined
  directory: string
  messages: readonly SessionMessageInfo[]
  working: boolean
  requests: SessionRequestModel
  model?: string
}) {
  const language = useLanguage()
  const server = useServerSDK()
  const t = (key: string, params?: Record<string, string | number>) =>
    language.t(key as Parameters<typeof language.t>[0], params as never) ?? key

  const turn = createMemo(() => {
    const messages = props.messages
    const start = messages.findLastIndex((message) => message.type === "user")
    if (start < 0) return undefined
    const user = messages[start]
    if (user?.type !== "user") return undefined
    const assistants = messages.slice(start + 1).filter((message): message is SessionMessageAssistant => message.type === "assistant")
    return { user, assistants, content: assistants.flatMap((message) => message.content) as RunContentLike[] }
  })

  const copy = (): RunStepCopy => {
    const pair = (key: string): [string, string] => [t(`panacode.run.verb.${key}`), t(`panacode.run.verb.${key}.done`)]
    return {
      verbs: {
        think: pair("think"),
        read: pair("read"),
        search: pair("search"),
        edit: pair("edit"),
        write: pair("write"),
        terminal: pair("terminal"),
        review: pair("review"),
        web: pair("web"),
        task: pair("task"),
        plan: pair("plan"),
        tool: pair("tool"),
      },
    }
  }

  const tools = createMemo(() =>
    (turn()?.content ?? []).filter((item): item is SessionMessageAssistantTool & RunContentLike => item.type === "tool"),
  )

  const pending = createMemo(() => {
    const request = props.requests.permissionRequest()
    if (!request || request.sessionID !== props.sessionID || request.source?.type !== "tool") return undefined
    const sourceID = request.source.id
    const tool = tools().find((item) => item.id === sourceID)
    return tool ? { request, tool } : undefined
  })

  const changes = createMemo(() => {
    const diffs: Record<string, DiffLine[]> = {}
    for (const tool of tools()) {
      if (runToolKind(tool.name).mark !== "edit") continue
      for (const change of toolFileChanges(tool as SessionMessageAssistantTool)) {
        const root = props.directory.replace(/\/+$/, "")
        const path = change.file.startsWith(root + "/") ? change.file.slice(root.length + 1) : change.file
        diffs[path] = [...(diffs[path] ?? []), ...patchToLines(change.patch)]
      }
    }
    return diffs
  })

  const run = createMemo((): AgentRunState | undefined => {
    const current = turn()
    if (!current) return undefined
    const waitingTool = pending()?.tool
    const steps = runSteps(current.content, {
      copy: copy(),
      root: props.directory,
      waiting: (id) => id === waitingTool?.id || toolWaitingApproval(id),
      notes: notes(),
    }).map((step) => {
      if (step.status !== "waiting" || !waitingTool || step.id !== waitingTool.id) return step
      const change = pendingChange(waitingTool, props.directory)
      return change ? { ...step, change } : step
    })
    const last = current.assistants.at(-1)
    const stopped = !props.working && current.assistants.some((message) => interrupted(message.error))
    const status: AgentRunState["status"] = props.working
      ? pending()
        ? "waiting"
        : "working"
      : stopped
        ? "stopped"
        : "done"
    const reply = [...current.content].reverse().find((item) => item.type === "text" && item.text.trim())
    const summary = reply && reply.type === "text" ? reply.text.trim().replace(/```[\s\S]*?```/g, " ").replace(/[`*_#>]/g, "").replace(/\s+/g, " ") : ""
    const files = Object.entries(changes()).map(([path, lines]) => changedFile(path, lines))
    return {
      status,
      startedAt: current.user.time.created,
      endedAt: props.working ? undefined : (last?.time.completed ?? last?.time.created ?? current.user.time.created),
      steps,
      files,
      result:
        status === "done"
          ? {
              summary: summary.length > 320 ? `${summary.slice(0, 319)}…` : summary,
              files,
              checks: runChecks(current.content),
            }
          : undefined,
    }
  })

  // A run is the turn's agent work: it shows once the turn calls a tool, and until the user closes it.
  const visible = () => {
    const current = turn()
    if (!current || dismissed().has(current.user.id)) return false
    return tools().length > 0
  }

  const labels = (): Partial<AgentRunLabels> => ({
    steps: t("panacode.run.steps"),
    working: t("panacode.run.working"),
    waiting: t("panacode.run.waiting"),
    done: t("panacode.run.done"),
    stopped: t("panacode.run.stopped"),
    review: t("panacode.run.review"),
    stop: t("panacode.run.stop"),
    dismiss: t("panacode.run.dismiss"),
    secondsOfWork: (seconds) => t("panacode.run.secondsOfWork", { seconds }),
    stepsFolded: (count, seconds) => t(count === 1 ? "panacode.run.stepsFolded.one" : "panacode.run.stepsFolded", { count, seconds }),
    filesChanged: (count) => t(count === 1 ? "panacode.run.filesChanged.one" : "panacode.run.filesChanged.other", { count }),
    added: (count) => t("panacode.run.added", { count }),
    removed: (count) => t("panacode.run.removed", { count }),
    changedFiles: t("panacode.run.changedFiles"),
    nothingWritten: t("panacode.run.nothingWritten"),
    approve: t("panacode.approvals.approve"),
    reject: t("panacode.run.reject"),
    whatShouldChange: t("panacode.run.whatShouldChange"),
    rejectPlaceholder: t("panacode.run.rejectPlaceholder"),
    cancel: t("panacode.run.cancel"),
    sendBack: t("panacode.run.sendBack"),
    yourFeedback: t("panacode.run.yourFeedback"),
    stoppedTitle: t("panacode.run.stoppedTitle"),
    stoppedBody: t("panacode.run.stoppedBody"),
    failed: t("panacode.run.failed"),
    approvedChanges: (path) => t("panacode.run.approvedChanges", { path }),
    waitingFirst: t("panacode.run.waitingFirst"),
  })

  const task = () => {
    const text = turn()?.user.text.trim().split("\n")[0] ?? ""
    return text.length > 90 ? `${text.slice(0, 89)}…` : text
  }

  const orchestrated = () => tools().some((tool) => tool.name === "subagent" || tool.name === "task")
  const stop = () =>
    props.sessionID ? void server.api.session.interrupt({ sessionID: props.sessionID }).catch(() => undefined) : undefined
  const dismiss = () => {
    const id = turn()?.user.id
    if (id) setDismissed((all) => new Set([...all, id]))
  }

  return (
    <Switch>
      <Match when={visible() && orchestrated() && turn()}>
        {(current) => (
          <PanacodeOrchestrator
            user={current().user}
            assistants={current().assistants}
            working={props.working}
            directory={props.directory}
            model={props.model}
            onStop={props.sessionID ? stop : undefined}
            onDismiss={dismiss}
          />
        )}
      </Match>
    <Match when={visible() && run()}>
      {(state) => (
        <AgentRun
          task={task()}
          model={props.model ? { name: props.model, mark: <BrandMark size={14} /> } : undefined}
          run={state()}
          labels={labels()}
          diffs={changes()}
          busy={props.requests.permissionResponding()}
          onApprove={() => props.requests.decide("once")}
          onReject={(change: ProposedChange, reason: string) => {
            setNotes((all) => ({ ...all, [change.id]: reason }))
            props.requests.decide("reject", reason)
          }}
          onStop={props.sessionID ? stop : undefined}
          onDismiss={dismiss}
        />
      )}
    </Match>
    </Switch>
  )
}
