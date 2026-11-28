import { Predicate, Schema } from "effect"
import panacode from "../../../../ui/src/theme/themes/panacode.json"
import type { BackgroundTheme } from "../../shared/ipc-rpc/app"

const Background = Schema.Struct({
  id: Schema.String,
  scheme: Schema.Literals(["light", "dark", "system"]),
  light: Schema.optionalKey(Schema.String),
  dark: Schema.optionalKey(Schema.String),
})

const isBackground = Schema.is(Background)

function readBackground(value: Schema.Json | undefined): typeof Background.Type | undefined {
  return isBackground(value) ? value : undefined
}

export function storedWindowColor(stored: Schema.Json | undefined, system: BackgroundTheme["mode"]) {
  if (Predicate.isString(stored)) return stored
  const saved = readBackground(stored)
  const mode = saved && saved.scheme !== "system" ? saved.scheme : system

  return saved?.[mode] || panacode[mode].overrides["background-base"]
}

export function recordWindowColor(stored: Schema.Json | undefined, color: string, theme?: BackgroundTheme) {
  if (!theme) return color
  const saved = readBackground(stored)
  const previous = saved?.id === theme.id ? saved : undefined

  if (previous?.scheme === theme.scheme && previous[theme.mode] === color) return previous

  return { ...previous, id: theme.id, scheme: theme.scheme, [theme.mode]: color }
}
