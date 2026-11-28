import { builtinCatalog } from "@opencode/plugin/gui/builtin"
import { Plugin, Store } from "@opencode/plugin/gui"
import { OpenAppPreferences } from "./apps"
import en from "./i18n/en"

export default Plugin.define({
  stores: {
    // The open-in-app choice. Only the desktop reads it.
    app: Store.global(OpenAppPreferences, { app: "finder" }, "open.app"),
  },
  i18n: builtinCatalog({ en }),
})
