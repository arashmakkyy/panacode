import { Show } from "solid-js"
import type { PermissionRequest } from "@opencode/client/promise"
import { AgentApprovals } from "@panacode/ui/features/agent-approvals"
import { toApprovalRequests } from "@panacode/ui/adapters/agent-approvals"
import { useLanguage } from "@/runtime/i18n/language"
import { SessionPermissionDock } from "@/session/requests/session-permission-dock"

/**
 * Thin presentation bridge for permission requests.
 * `panacode` uses Arc Agent Approvals chrome with once / always / reject preserved.
 * `classic` keeps the upstream dock (for regression comparison).
 */
export function PanacodePermissionAdapter(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
  presentation?: "classic" | "panacode"
}) {
  const language = useLanguage()
  const mode = () => props.presentation ?? "panacode"

  return (
    <Show
      when={mode() === "panacode"}
      fallback={
        <SessionPermissionDock request={props.request} responding={props.responding} onDecide={props.onDecide} />
      }
    >
      <AgentApprovals
        requests={toApprovalRequests([
          {
            id: props.request.id,
            title: language.t("notification.permission.title"),
            scope: props.request.action,
            detail: (
              <div>
                <Show when={props.request.message}>{(message) => <p>{message()}</p>}</Show>
                <code>{props.request.action}</code>
              </div>
            ),
          },
        ])}
        onApprove={(id) => {
          if (id !== props.request.id || props.responding) return
          props.onDecide("once")
        }}
        onAlways={(id) => {
          if (id !== props.request.id || props.responding) return
          props.onDecide("always")
        }}
        onReject={(id) => {
          if (id !== props.request.id || props.responding) return
          props.onDecide("reject")
        }}
        labels={{
          approve: language.t("ui.permission.allowOnce"),
          always: language.t("ui.permission.allowAlways"),
          reject: language.t("ui.permission.deny"),
        }}
      />
    </Show>
  )
}
