import { For, Show, type JSX } from "solid-js"
import { Button } from "../../primitives/button"
import "./agent-approvals.css"

export type ApprovalRequest = {
  id: string
  title: string
  detail?: JSX.Element
  scope?: string
}

export interface AgentApprovalsProps {
  requests: readonly ApprovalRequest[]
  onApprove: (id: string) => void
  onReject: (id: string) => void
  /** Optional "always allow" — maps to OpenCode permission `always`. */
  onAlways?: (id: string) => void
  class?: string
  labels: { approve: string; reject: string; always?: string }
}

/** Permission / approval dock — preserve OpenCode authorization semantics in the adapter. */
export function AgentApprovals(props: AgentApprovalsProps) {
  return (
    <div data-component="panacode-agent-approvals" data-panacode-feature="agent-approvals" class={props.class}>
      <For each={props.requests}>
        {(request) => (
          <article data-slot="approval">
            <header>
              <h4>{request.title}</h4>
              <span>{request.scope}</span>
            </header>
            <div data-slot="approval-detail">{request.detail}</div>
            <div data-slot="approval-actions">
              <Button variant="secondary" size="sm" onClick={() => props.onReject(request.id)}>
                {props.labels.reject}
              </Button>
              <Show when={props.onAlways && props.labels.always}>
                <Button variant="secondary" size="sm" onClick={() => props.onAlways?.(request.id)}>
                  {props.labels.always}
                </Button>
              </Show>
              <Button variant="primary" size="sm" onClick={() => props.onApprove(request.id)}>
                {props.labels.approve}
              </Button>
            </div>
          </article>
        )}
      </For>
    </div>
  )
}
