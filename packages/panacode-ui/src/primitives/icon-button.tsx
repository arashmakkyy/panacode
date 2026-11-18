import { type ComponentProps, type JSX, splitProps } from "solid-js"
import "./button.css"

export type IconButtonSize = "sm" | "md" | "lg"

export interface IconButtonProps extends ComponentProps<"button"> {
  size?: IconButtonSize
  label: string
  children: JSX.Element
}

/** Square Arc icon button. `label` is the accessible name; the icon is the visible content. */
export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, ["size", "label", "class", "classList", "children"])

  return (
    <button
      type="button"
      {...rest}
      aria-label={local.label}
      data-component="panacode-icon-button"
      data-panacode-primitive="icon-button"
      data-size={local.size ?? "md"}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </button>
  )
}
