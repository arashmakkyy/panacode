import { createSignal, For, type JSX } from "solid-js"
import "./surface.css"

export function Spinner(props: { label: string }) {
  return <span data-component="panacode-spinner" data-panacode-primitive="spinner" role="status" aria-label={props.label} />
}

export function Skeleton(props: { width?: string; height?: string; class?: string }) {
  return (
    <span
      data-component="panacode-skeleton"
      data-panacode-primitive="skeleton"
      class={props.class}
      style={{ width: props.width ?? "40%", height: props.height }}
      aria-hidden="true"
    />
  )
}

export function ScrollArea(props: { children: JSX.Element; class?: string; label?: string }) {
  return (
    <div
      data-component="panacode-scroll-area"
      data-panacode-primitive="scroll-area"
      class={props.class}
      tabindex="0"
      aria-label={props.label}
    >
      {props.children}
    </div>
  )
}

export type ToastTone = "info" | "success" | "danger"

export type ToastInput = {
  title: string
  description?: string
  tone?: ToastTone
}

type ToastItem = ToastInput & { id: number }

const [toasts, setToasts] = createSignal<ToastItem[]>([])
let nextId = 0

export function showToast(input: ToastInput) {
  const id = ++nextId
  setToasts((items) => [...items, { ...input, id }])
  setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4200)
}

export function ToastRegion(props: { label: string }) {
  return (
    <div data-component="panacode-toasts" data-panacode-primitive="toast" role="region" aria-label={props.label}>
      <For each={toasts()}>
        {(toast) => (
          <div data-slot="toast" data-tone={toast.tone ?? "info"} role="status">
            <strong>{toast.title}</strong>
            {toast.description ? <p>{toast.description}</p> : null}
          </div>
        )}
      </For>
    </div>
  )
}
