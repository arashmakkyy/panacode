import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import type { PermissionRequest } from "@opencode/client/promise"
import {
  AgentApprovals,
  type ApprovalDecision,
  type ApprovalLabels,
  type ApprovalResolved,
} from "@panacode/ui/features/agent-approvals"
import { fromPermissionRequest, toPermissionReply, type PermissionCopy } from "@panacode/ui/adapters/agent-approvals"
import { useLanguage } from "@/runtime/i18n/language"
import { hasAppLabel } from "@/runtime/i18n/app-label"
import { SessionPermissionDock } from "@/session/requests/session-permission-dock"
import { markToolWaiting } from "@/session/panacode-tool-state"

import type { ConfirmedPermission } from "./requests/model"

const outcomes = { always: "allowed", once: "approved", reject: "denied" } as const

/**
 * Presentation bridge: OpenCode permission requests render as the Arc Agent Approvals block.
 * Replies keep OpenCode semantics (once / always / reject). `classic` keeps the upstream dock.
 */
export function PanacodePermissionAdapter(props: {
  request: PermissionRequest
  requests?: PermissionRequest[]
  sessionTitle?: (id: string) => string
  responding: boolean
  history: readonly ConfirmedPermission[]
  onDecide: (response: "once" | "always" | "reject", message?: string, requestID?: string) => void
  presentation?: "classic" | "panacode"
}) {
  const language = useLanguage()
  const mode = () => props.presentation ?? "panacode"
  // The waiting tool row in the transcript shows the approval state while this request is open.
  createEffect(() => {
    for (const request of props.requests ?? [props.request]) {
      if (request.source?.type !== "tool") continue
      const id = request.source.id
      markToolWaiting(id, true)
      onCleanup(() => markToolWaiting(id, false))
    }
  })
  const [pending, setPending] = createSignal<{ id: string; decision: ApprovalDecision }>()

  const t = language.t

  const copy = (): PermissionCopy => ({
    title: {
      shell: t("panacode.approvals.title.shell"),
      edit: t("panacode.approvals.title.edit"),
      create: t("panacode.approvals.title.create"),
      read: t("panacode.approvals.title.read"),
      web: t("panacode.approvals.title.web"),
      directory: t("panacode.approvals.title.directory"),
      tool: t("panacode.approvals.title.tool"),
    },
    tool: (action) => {
      const key = `settings.permissions.tool.${action === "shell" ? "bash" : action}.title` as const

      return hasAppLabel(key) ? t(key) : undefined
    },
    command: t("panacode.approvals.arg.command"),
    path: t("panacode.approvals.arg.path"),
    url: t("panacode.approvals.arg.url"),
    resource: t("panacode.approvals.arg.resource"),
    pattern: t("panacode.approvals.arg.pattern"),
    changes: t("panacode.approvals.arg.changes"),
  })

  const labels = (): Partial<ApprovalLabels> => ({
    title: t("panacode.approvals.heading"),
    pending: (count) => t("panacode.approvals.pending", { count }),
    approve: t("panacode.approvals.approve"),
    deny: t("ui.permission.deny"),
    always: t("panacode.approvals.always"),
    risk: { low: t("panacode.approvals.risk.low"), medium: t("panacode.approvals.risk.medium"), high: t("panacode.approvals.risk.high") },
    riskWord: t("panacode.approvals.risk.word"),
    justNow: t("panacode.approvals.justNow"),
    minutesAgo: (minutes) => t("panacode.approvals.minutesAgo", { minutes }),
    sending: t("panacode.approvals.sending"),
    denying: t("panacode.approvals.denying"),
    resolved: (count) => t("panacode.approvals.resolved", { count }),
    outcome: {
      approved: t("panacode.approvals.outcome.approved"),
      denied: t("panacode.approvals.outcome.denied"),
      allowed: t("panacode.approvals.outcome.allowed"),
    },
    hintMove: t("panacode.approvals.hint.move"),
    hintApprove: t("panacode.approvals.approve"),
    hintDeny: t("ui.permission.deny"),
    arguments: t("panacode.approvals.arguments"),
    denialNote: t("panacode.approvals.denialNote"),
  })

  const requestedAt = createMemo(on(() => props.request.id, () => Date.now()))

  const cards = createMemo(() => (props.requests ?? [props.request]).map((request) => ({
    ...fromPermissionRequest(request, copy(), requestedAt()),
    sourceDetail: props.sessionTitle?.(request.sessionID),
  })))

  const history = createMemo<ApprovalResolved[]>(() =>
    props.history
      .filter((entry) => entry.request.sessionID === props.request.sessionID)
      .map((entry) => {
        const item = fromPermissionRequest(entry.request, copy())

        return { id: item.id, summary: item.summary ?? item.title, icon: item.icon, at: entry.at, outcome: outcomes[entry.decision] }
      }),
  )

  const decide = (id: string, decision: ApprovalDecision, message?: string) => {
    const card = cards().find((item) => item.id === id)

    if (!card || props.responding || (decision === "always" && !card.canAlways)) return
    setPending({ id, decision })
    props.onDecide(toPermissionReply(decision), message, id)
  }

  return (
    <Show
      when={mode() === "panacode"}
      fallback={
        <SessionPermissionDock request={props.request} responding={props.responding} onDecide={props.onDecide} />
      }
    >
      <AgentApprovals
        requests={cards()}
        resolved={history()}
        sending={props.responding ? pending() : undefined}
        onDecision={decide}
        labels={labels()}
      />
    </Show>
  )
}
