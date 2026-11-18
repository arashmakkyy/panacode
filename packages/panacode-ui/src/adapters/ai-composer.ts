/** Presentation helpers for the Panacode composer chrome. Domain submit/stop stays in app controllers. */

export type ComposerMode = "idle" | "streaming" | "disabled"

export function toComposerMode(input: {
  busy?: boolean
  streaming?: boolean
  disabled?: boolean
}): ComposerMode {
  if (input.disabled) return "disabled"
  if (input.busy || input.streaming) return "streaming"
  return "idle"
}
