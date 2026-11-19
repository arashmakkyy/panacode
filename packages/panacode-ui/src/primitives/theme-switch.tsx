import type { JSX } from "solid-js"
import { SegmentedControl } from "./segmented-control"

export type ColorScheme = "system" | "light" | "dark"

export interface ThemeSwitchProps {
  value: ColorScheme
  onChange: (value: ColorScheme) => void
  labels: Record<ColorScheme, string>
  "aria-label"?: string
}

const glyph = (body: JSX.Element) => () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {body}
  </svg>
)

// Factories: a Solid node can live in one place only.
const glyphs: Record<ColorScheme, () => JSX.Element> = {
  system: () =>
    glyph(
      <>
        <rect width="20" height="14" x="2" y="3" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>,
    )(),
  light: () =>
    glyph(
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </>,
    )(),
  dark: () => glyph(<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />)(),
}

/** Arc theme switch: the color scheme as a segmented control with a glyph per scheme; the highlight springs. */
export function ThemeSwitch(props: ThemeSwitchProps) {
  const order: ColorScheme[] = ["system", "light", "dark"]
  return (
    <SegmentedControl
      class="pc-theme-switch"
      aria-label={props["aria-label"]}
      value={props.value}
      onChange={props.onChange}
      options={order.map((value) => ({
        value,
        label: (
          <span class="pc-theme-switch-option">
            {glyphs[value]()}
            <span>{props.labels[value]}</span>
          </span>
        ),
      }))}
    />
  )
}
