import { builtinCatalog } from "@opencode/plugin/gui/builtin"
import { Plugin, Store } from "@opencode/plugin/gui"
import { History } from "./history"
import en from "./i18n/en"

export default Plugin.define({
  stores: {
    // Pages the browser showed, for the new tab page and the address field's suggestions. One list for every
    // session and server, kept on this device.
    history: Store.global(History, { visits: [] }),
  },
  i18n: builtinCatalog({ en }),
})
