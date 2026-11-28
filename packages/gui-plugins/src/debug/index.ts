import { builtinCatalog } from "@opencode/plugin/gui/builtin"
import { Schema } from "effect"
import { Plugin, Store } from "@opencode/plugin/gui"
import en from "./i18n/en"

export default Plugin.define({
  stores: {
    // Whether the bar, and the Motion panel under it, are open; kept across reloads, restarts and updates.
    bar: Store.global(Schema.Struct({ visible: Schema.Boolean, motion: Schema.Boolean }), {
      visible: false,
      motion: false,
    }),
  },
  i18n: builtinCatalog({ en }),
})
