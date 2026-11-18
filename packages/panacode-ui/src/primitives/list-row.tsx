import { type JSX, splitProps } from "solid-js"
import "./surface.css"

export interface ListRowProps {
  title: JSX.Element
  detail?: JSX.Element
  trailing?: JSX.Element
  onClick?: () => void
  class?: string
}

/** Arc list row used by the session list and sidebar navigation. */
export function ListRow(props: ListRowProps) {
  const [local] = splitProps(props, ["title", "detail", "trailing", "onClick", "class"])
  const content = () => (
    <>
      <span data-slot="row-copy">
        <span data-slot="row-title">{local.title}</span>
        {local.detail ? <span data-slot="row-detail">{local.detail}</span> : null}
      </span>
      {local.trailing}
    </>
  )

  return local.onClick ? (
    <button
      type="button"
      data-component="panacode-list-row"
      data-panacode-primitive="list-row"
      class={local.class}
      onClick={local.onClick}
    >
      {content()}
    </button>
  ) : (
    <div data-component="panacode-list-row" data-panacode-primitive="list-row" class={local.class}>
      {content()}
    </div>
  )
}
