import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Product } from "../panacode/product.js"

/**
 * Runs after config/provider plugins so the Panacode connect allowlist wins
 * over models.dev and user config without deleting upstream provider code.
 * Clear `Product.connectAllowlist` to restore the full catalog.
 */
export const PanacodeOverlayPlugin = define({
  id: "opencode.panacode.overlay",
  effect: Effect.fn(function* (ctx) {
    const allow = Product.connectAllowlist
    if (!allow) return
    const keep = new Set(allow)
    yield* ctx.integration.transform((integrations) => {
      for (const item of integrations.list()) {
        if (keep.has(item.id)) continue
        // Live refs carry MCP `metadata.source`; the plugin IntegrationRef type omits it.
        if ((item as { metadata?: { source?: unknown } }).metadata?.source === "mcp") continue
        integrations.remove(item.id)
      }
    })
    yield* ctx.provider.transform((providers) => {
      for (const item of providers.list()) {
        if (keep.has(item.provider.id)) continue
        providers.remove(item.provider.id)
      }
    })
  }),
})
