import { splitProps, type JSX, type ParentProps } from "solid-js"
import "./badge.css"

export function Badge(
  props: ParentProps<{
    tone?: "neutral" | "success" | "warning" | "danger" | "info"
    class?: string
    classList?: Record<string, boolean | undefined>
  }> &
    JSX.HTMLAttributes<HTMLSpanElement>,
) {
  const [local, others] = splitProps(props, ["children", "class", "classList", "tone"])
  return (
    <span
      {...others}
      data-component="panacode-badge"
      data-tone={local.tone ?? "neutral"}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </span>
  )
}
