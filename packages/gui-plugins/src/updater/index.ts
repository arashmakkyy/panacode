import { builtinCatalog } from "@opencode/plugin/gui/builtin"
import { Schema } from "effect"
import { Plugin, Store } from "@opencode/plugin/gui"
import { BuiltinStore } from "@opencode/plugin/gui/builtin"
import en from "./i18n/en"

const ReleaseNotes = Schema.Struct({ enabled: Schema.Boolean })

const Seen = Schema.Struct({ version: Schema.optional(Schema.String) })

export default Plugin.define({
  stores: {
    // Whether What's New shows after an update; stored before in the app settings.
    releaseNotes: BuiltinStore.global(
      ReleaseNotes,
      { enabled: true },
      {
        key: "settings.v3",
        pick: (value: { general?: { releaseNotes?: unknown } } | null) => {
          const enabled = value?.general?.releaseNotes

          return enabled === undefined ? undefined : { enabled }
        },
      },
    ),
    // The version whose What's New was last shown or skipped; stored before under the app's own key.
    seen: Store.global(Seen, {}, "highlights.v1"),
  },
  i18n: builtinCatalog({ en }),
})
