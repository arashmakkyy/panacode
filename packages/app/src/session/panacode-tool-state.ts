import { createSignal } from "solid-js"

// Tool call ids that are waiting on a permission decision right now (fed by the approvals adapter from real requests).
const [waiting, setWaiting] = createSignal<ReadonlySet<string>>(new Set())

export const toolWaitingApproval = (callID: string) => waiting().has(callID)

export function markToolWaiting(callID: string | undefined, on: boolean) {
  if (!callID) return
  setWaiting((current) => {
    if (current.has(callID) === on) return current
    const next = new Set(current)
    if (on) next.add(callID)
    else next.delete(callID)
    return next
  })
}
