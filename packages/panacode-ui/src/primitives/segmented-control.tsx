import { For, splitProps, type JSX } from "solid-js"
import "./segmented-control.css"

export type SegmentOption<T extends string = string> = {
  value: T
  label: JSX.Element
}

export interface SegmentedControlProps<T extends string = string> {
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  class?: string
  "aria-label"?: string
}

export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>) {
  const [local] = splitProps(props, ["options", "value", "onChange", "class", "aria-label"])

  return (
    <div
      role="tablist"
      aria-label={local["aria-label"]}
      data-component="panacode-segmented"
      data-panacode-primitive="segmented-control"
      class={local.class}
    >
      <For each={local.options}>
        {(option) => (
          <button
            type="button"
            role="tab"
            aria-selected={local.value === option.value}
            data-active={local.value === option.value ? "" : undefined}
            onClick={() => local.onChange(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  )
}
