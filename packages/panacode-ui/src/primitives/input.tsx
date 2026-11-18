import { splitProps, type ComponentProps } from "solid-js"
import "./input.css"

export interface InputProps extends ComponentProps<"input"> {}

export function Input(props: InputProps) {
  const [local, rest] = splitProps(props, ["class", "classList"])
  return (
    <input
      {...rest}
      data-component="panacode-input"
      data-panacode-primitive="input"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    />
  )
}
