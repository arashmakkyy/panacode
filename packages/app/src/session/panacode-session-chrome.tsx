import type { ParentProps } from "solid-js"

/**
 * Marks session chrome for Panacode shell CSS without replacing the timeline engine.
 * Wrap timeline/composer hosts when a local data-attribute hook is needed.
 */
export function PanacodeSessionChrome(props: ParentProps<{ feature?: string }>) {
  return (
    <div data-panacode-session-chrome="" data-panacode-feature={props.feature ?? "session"}>
      {props.children}
    </div>
  )
}
