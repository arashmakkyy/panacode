import { LEGACY_SETTINGS_STORE, SETTINGS_STORE } from "./keys"

export function hasExistingAppState(entries: Array<{ name: string; directory: boolean }>) {
  return entries.some((entry) => {
    if (entry.name === SETTINGS_STORE || entry.name === LEGACY_SETTINGS_STORE) return true

    if (entry.name.endsWith(".dat")) return true

    if (entry.name === "drafts.sqlite") return true

    if (/^window-state-.+\.json$/.test(entry.name)) return true

    return entry.directory && entry.name === "opencode"
  })
}
