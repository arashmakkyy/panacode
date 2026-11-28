import { builtinCatalog } from "@opencode/plugin/gui/builtin"
import { Plugin } from "@opencode/plugin/gui"
import en from "./i18n/en"

/** Published as `terminal.toggle`; the desktop menu names it. */
export const terminalToggleCommand = { id: "toggle", bind: "ctrl+`" }

export default Plugin.define({
  i18n: builtinCatalog({ en }),
})
