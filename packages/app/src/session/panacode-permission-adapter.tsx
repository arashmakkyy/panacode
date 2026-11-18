import { createSignal, Show } from "solid-js"
import type { PermissionRequest } from "@opencode/client/promise"
import {
  AgentApprovals,
  type ApprovalDecision,
  type ApprovalLabels,
  type ApprovalResolved,
} from "@panacode/ui/features/agent-approvals"
import { fromPermissionRequest, toPermissionReply, type PermissionCopy } from "@panacode/ui/adapters/agent-approvals"
import { useLanguage } from "@/runtime/i18n/language"
import { SessionPermissionDock } from "@/session/requests/session-permission-dock"

// First time each request was shown, and this window's decisions per session (memory only, real events).
const seen = new Map<string, number>()
const [log, setLog] = createSignal<Record<string, ApprovalResolved[]>>({})

/**
 * Presentation bridge: OpenCode permission requests render as the Arc Agent Approvals block.
 * Replies keep OpenCode semantics (once / always / reject). `classic` keeps the upstream dock.
 */
export function PanacodePermissionAdapter(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
  presentation?: "classic" | "panacode"
}) {
  const language = useLanguage()
  const mode = () => props.presentation ?? "panacode"
  const [pending, setPending] = createSignal<{ id: string; decision: ApprovalDecision }>()

  const t = (key: string, params?: Record<string, string | number>) =>
    language.t(key as Parameters<typeof language.t>[0], params as never)

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
      const key = `settings.permissions.tool.${action}.title`
      const value = t(key)
      return value === key ? undefined : value
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
  })

  const card = () => {
    if (!seen.has(props.request.id)) seen.set(props.request.id, Date.now())
    return fromPermissionRequest(props.request, copy(), seen.get(props.request.id))
  }

  const decide = (id: string, decision: ApprovalDecision) => {
    if (id !== props.request.id || props.responding) return
    const current = card()
    setPending({ id, decision })
    const outcome: ApprovalResolved["outcome"] =
      decision === "approved" ? "approved" : decision === "always" ? "allowed" : "denied"
    const session = props.request.sessionID
    setLog((all) => ({
      ...all,
      [session]: [{ id, summary: current.summary ?? current.title, outcome, at: Date.now(), icon: current.icon }, ...(all[session] ?? [])].slice(0, 20),
    }))
    props.onDecide(toPermissionReply(decision))
  }

  return (
    <Show
      when={mode() === "panacode"}
      fallback={
        <SessionPermissionDock request={props.request} responding={props.responding} onDecide={props.onDecide} />
      }
    >
      <AgentApprovals
        requests={[card()]}
        resolved={log()[props.request.sessionID] ?? []}
        sending={props.responding ? pending() : undefined}
        onDecision={decide}
        labels={labels()}
      />
    </Show>
  )
}
