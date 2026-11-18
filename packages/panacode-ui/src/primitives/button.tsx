import { Show, type ComponentProps, splitProps } from "solid-js"
import "./button.css"

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger"
export type ButtonSize = "sm" | "md" | "lg"

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

/** Same press depths as the Arc button: icon buttons deeper, wide buttons shallower. */
function pressScale(width: number) {
  if (width > 220) return 0.985
  if (width > 0 && width <= 48) return 0.96
  return 0.97
}

/**
 * Arc button. Loading stays focusable and swallows the click, matching the reference.
 * Press scale is applied in script so a menu trigger (aria-haspopup) is not measured while shrunk.
 */
export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "loading", "class", "classList", "disabled", "children"])
  let button: HTMLButtonElement | undefined

  const anchorsLayer = () => {
    const popup = button?.getAttribute("aria-haspopup")
    return (popup !== null && popup !== "false") || button?.getAttribute("role") === "combobox"
  }

  const press = (down: boolean) => {
    if (!button) return
    const skip = !down || local.disabled || local.loading || anchorsLayer() || reducedMotion()
    button.style.transform = skip ? "" : `scale(${pressScale(button.offsetWidth)})`
  }

  return (
    <button
      type="button"
      {...rest}
      ref={button}
      disabled={local.disabled}
      aria-disabled={local.loading || undefined}
      aria-busy={local.loading || undefined}
      data-component="panacode-button"
      data-panacode-primitive="button"
      data-variant={local.variant ?? "primary"}
      data-size={local.size ?? "md"}
      data-loading={local.loading ? "" : undefined}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      onPointerDown={(event) => {
        if (event.button === 0) press(true)
      }}
      onPointerUp={() => press(false)}
      onPointerLeave={() => press(false)}
      onPointerCancel={() => press(false)}
      onClick={(event) => {
        if (local.loading) {
          event.preventDefault()
          return
        }
        if (typeof props.onClick === "function") props.onClick(event)
      }}
    >
      <Show when={local.loading}>
        <span data-slot="button-spinner" aria-hidden="true" />
      </Show>
      <span data-slot="button-label">{local.children}</span>
    </button>
  )
}

function reducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
}
