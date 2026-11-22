import { createEffect, createMemo, on } from "solid-js"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import {
  AgentOrchestrator,
  type OrchestratorLabels,
  type OrchestratorView,
} from "@panacode/ui/features/agent-orchestrator"
import { orchestratorLane, subagentSessionID, type ChildLike } from "@panacode/ui/adapters/agent-orchestrator"
import { runToolKind, type settledRun, type RunContentLike, type RunToolLike } from "@panacode/ui/adapters/agent-run"
import { BrandMark } from "@panacode/ui/brand"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"

const plain = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#>]/g, "")
    .trim()

/**
 * The Arc Agent Orchestrator for a turn where the lead hands work to subagents: each subagent call is a lane, its
 * child session is the worker (read live from the session store), and the lead's reply after the lanes return is the
 * summary. Stop interrupts the lead, which stops its children.
 */
export function PanacodeOrchestrator(props: {
  user: Extract<SessionMessageInfo, { type: "user" }>
  assistants: readonly Extract<SessionMessageInfo, { type: "assistant" }>[]
  working: boolean
  settled: ReturnType<typeof settledRun>
  directory: string
  model?: string
  onStop?: () => void
  onDismiss: () => void
}) {
  const language = useLanguage()
  const data = useData()
  const platform = usePlatform()
  const server = useServerSDK()
  const t = (key: string, params?: Record<string, string | number>) =>
    language.t(key as Parameters<typeof language.t>[0], params as never) ?? key

  const content = createMemo(() => props.assistants.flatMap((message) => message.content) as RunContentLike[])
  const calls = createMemo(() =>
    content().filter((item): item is RunToolLike & SessionMessageAssistantTool => item.type === "tool" && (item.name === "subagent" || item.name === "task")),
  )
  const children = createMemo(() => calls().flatMap((call) => subagentSessionID(call) ?? []))

  // Child sessions are loaded once; the store then follows them live.
  const synced = new Set<string>()
  createEffect(
    on(children, (ids) => {
      for (const id of ids) {
        if (synced.has(id)) continue
        synced.add(id)
        if (data.session.message.list(id).length > 0) continue
        void Promise.all([data.session.sync(id), data.session.message.sync(id)]).catch(() => undefined)
      }
    }),
  )

  const toolLabel = (name: string) => t(`panacode.run.verb.${runToolKind(name).verb}`)

  const view = createMemo((): OrchestratorView => {
    const lanes = calls().map((call) => {
      const id = subagentSessionID(call)
      const child: ChildLike | undefined = id
        ? { messages: data.session.message.list(id) as ChildLike["messages"], running: data.session.status(id) === "running" }
        : undefined
      return orchestratorLane(call, child, {
        toolLabel,
        root: props.directory,
        worker: (agent) => (agent ? agent.charAt(0).toUpperCase() + agent.slice(1) : t("panacode.orch.worker")),
      })
    })
    const lastCall = content().findLastIndex((item) => item.type === "tool" && (item.name === "subagent" || item.name === "task"))
    const after = content().slice(lastCall + 1)
    const reply = [...after].reverse().find((item) => item.type === "text" && item.text.trim())
    const summary = reply && reply.type === "text" ? plain(reply.text) : ""
    const live = lanes.some((lane) => lane.status === "starting" || lane.status === "running")
    const terminal = !props.working ? props.settled?.status : undefined
    // Subagents can run in the background after the lead's message ends, so live lanes keep the run going.
    const working = props.working || live
    const phase: OrchestratorView["phase"] = terminal === "stopped" || terminal === "failed"
      ? terminal
      : !working
        ? "done"
        : lanes.length === 0 || lanes.every((lane) => lane.status === "planned")
          ? "planning"
          : live || lanes.some((lane) => lane.status === "planned") || !props.working
            ? "running"
            : "summarizing"
    const goal = props.user.text.trim().split("\n")[0] ?? ""
    return {
      goal: goal.length > 120 ? `${goal.slice(0, 119)}…` : goal,
      lead: { name: props.model ?? t("panacode.orch.lead"), mark: () => <BrandMark size={14} /> },
      phase,
      startedAt: props.user.time.created,
      endedAt: phase === "done" || phase === "stopped" || phase === "failed" ? props.settled?.endedAt : undefined,
      lanes,
      summary: phase === "failed" ? props.settled?.error ?? "" : summary,
    }
  })

  const labels = (): Partial<OrchestratorLabels> => ({
    eyebrow: t("panacode.orch.eyebrow"),
    lead: t("panacode.orch.lead"),
    plan: t("panacode.orch.plan"),
    planning: t("panacode.orch.planning"),
    dispatching: t("panacode.orch.dispatching"),
    returned: (done, total) => t("panacode.orch.returned", { done, total }),
    summarizing: t("panacode.orch.summarizing"),
    done: t("panacode.orch.done"),
    stopped: t("panacode.orch.stopped"),
    failed: t("panacode.run.failed"),
    stop: t("panacode.run.stop"),
    dismiss: t("panacode.run.dismiss"),
    summary: t("panacode.orch.summary"),
    summaryWaiting: t("panacode.orch.summaryWaiting"),
    summaryStopped: t("panacode.orch.summaryStopped"),
    copy: t("panacode.orch.copy"),
    copied: t("panacode.orch.copied"),
    status: {
      planned: t("panacode.orch.status.planned"),
      starting: t("panacode.orch.status.starting"),
      running: t("panacode.orch.status.running"),
      returned: t("panacode.orch.status.returned"),
      gaveup: t("panacode.orch.status.gaveup"),
      stopped: t("panacode.orch.status.stopped"),
    },
    thinking: t("panacode.orch.thinking"),
    starting: t("panacode.orch.starting"),
    toolCalls: (count) => t(count === 1 ? "panacode.orch.toolCalls.one" : "panacode.orch.toolCalls.other", { count }),
    noOutput: t("panacode.orch.noOutput"),
    nothingYet: t("panacode.orch.nothingYet"),
    transcript: (title) => t("panacode.orch.transcript", { title }),
    log: {
      dispatch: t("panacode.orch.log.dispatch"),
      tool: t("panacode.orch.log.tool"),
      toolResult: t("panacode.orch.log.toolResult"),
      output: t("panacode.orch.log.output"),
      error: t("panacode.orch.log.error"),
      result: t("panacode.orch.log.result"),
    },
    tokens: t("panacode.orch.tokens"),
    tok: t("panacode.orch.tok"),
    cost: t("panacode.orch.cost"),
    wallTime: t("panacode.orch.wallTime"),
    speedup: t("panacode.orch.speedup"),
    inParallel: t("panacode.orch.inParallel"),
    inSequence: t("panacode.orch.inSequence"),
    compare: t("panacode.orch.compare"),
    parallelLanes: (count) => t(count === 1 ? "panacode.orch.lanes.one" : "panacode.orch.lanes.other", { count }),
  })

  return (
    <AgentOrchestrator
      view={view()}
      labels={labels()}
      onStop={() => {
        props.onStop?.()
        // Background lanes are their own sessions, so stop each one still running.
        for (const id of children())
          if (data.session.status(id) === "running") void server.api.session.interrupt({ sessionID: id }).catch(() => undefined)
      }}
      onDismiss={props.onDismiss}
      onCopy={(text) => void (platform.writeClipboardText?.(text) ?? navigator.clipboard.writeText(text)).catch?.(() => undefined)}
    />
  )
}
