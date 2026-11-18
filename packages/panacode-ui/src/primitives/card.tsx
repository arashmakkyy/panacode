import { type JSX, splitProps } from "solid-js"
import "./surface.css"

export interface CardProps {
  children: JSX.Element
  class?: string
}

export function Card(props: CardProps) {
  const [local] = splitProps(props, ["children", "class"])

  return (
    <section data-component="panacode-card" data-panacode-primitive="card" class={local.class}>
      {local.children}
    </section>
  )
}
