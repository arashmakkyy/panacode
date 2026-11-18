import { type ComponentProps, splitProps } from "solid-js"
import "./button.css"

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger"
export type ButtonSize = "sm" | "md" | "lg"

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

/** Arc-inspired button shell. Keeps native button semantics for OpenCode keyboard/a11y contracts. */
export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "loading", "class", "classList", "disabled", "children"])
  const disabled = () => local.disabled || local.loading

  return (
    <button
      type="button"
      {...rest}
      disabled={disabled()}
      data-component="panacode-button"
      data-panacode-primitive="button"
      data-variant={local.variant ?? "primary"}
      data-size={local.size ?? "md"}
      data-loading={local.loading ? "" : undefined}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <span data-slot="button-label">{local.children}</span>
    </button>
  )
}
