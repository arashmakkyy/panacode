import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Product } from "@opencode/core/panacode/product"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PanacodeOverlayPlugin } from "@opencode/core/plugin/panacode-overlay"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { PanaAIPlugin } from "@opencode/core/plugin/provider/panaai"
import { Provider } from "@opencode/core/provider"
import { Document, Event, Info } from "@opencode/schema/config"
import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { eventually } from "../lib/eventually"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(Layer.merge(PluginTestLayer, Config.testLayer()))
const decode = Schema.decodeUnknownSync(Info)

const addPlugins = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, "test")
  yield* PanaAIPlugin.effect(host)
  yield* PanacodeOverlayPlugin.effect(host)
})

describe("PanaAIPlugin", () => {
  it.effect("registers as a built-in provider plugin with product defaults", () =>
    Effect.sync(() => {
      expect(PanaAIPlugin.id).toBe("opencode.provider.panaai")
      expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.panaai")
      expect(Product.provider.id).toBe("panaai")
      expect(Product.provider.stream).toBe(false)
      expect(Product.connectAllowlist).toEqual(["panaai"])
    }),
  )

  it.live("exposes only PanaAI on the connect allowlist and discovers /v1/models", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const requests: Array<{ authorization: string | null; path: string }> = []
        return {
          requests,
          server: Bun.serve({
            port: 0,
            fetch: (request) => {
              const url = new URL(request.url)
              requests.push({ authorization: request.headers.get("authorization"), path: url.pathname })
              return Response.json({
                object: "list",
                data: [
                  { id: "pana-demo", object: "model", owned_by: "panaai" },
                  { id: "pana-code", object: "model", owned_by: "panaai" },
                ],
              })
            },
          }),
        }
      }),
      ({ requests, server }) =>
        Effect.gen(function* () {
          const bus = yield* Bus.Service
          const config = yield* Config.Test
          const providers = yield* Provider.Service
          const modelState = yield* Model.Service
          const integrations = yield* Integration.Service
          const providerID = Provider.ID.make("panaai")
          const baseURL = `${server.url.origin}/v1`
          yield* config.setEntries([
            new Document({
              type: "document",
              info: decode({ providers: { panaai: { settings: { baseURL, apiKey: "pana-test-key" } } } }),
            }),
          ])
          yield* integrations.transform((editor) => {
            editor.update(Integration.ID.make("openai"), (integration) => {
              integration.name = "OpenAI"
            })
            editor.method.update({ integrationID: Integration.ID.make("openai"), method: { type: "key" } })
          })
          yield* providers.transform((editor) => {
            editor.update(Provider.ID.make("openai"), (provider) => {
              provider.name = "OpenAI"
              provider.activation = "auto"
            })
          })
          yield* addPlugins()
          yield* bus.publish(Event.Updated, {})
          yield* eventually(modelState.get(providerID, Model.ID.make("pana-demo")), (model) => model !== undefined)
          expect(yield* modelState.get(providerID, Model.ID.make("pana-code"))).toBeDefined()
          expect(yield* providers.get(providerID)).toMatchObject({
            id: providerID,
            name: "PanaAI",
            package: "@opencode/ai/providers/panaai",
            settings: {
              baseURL,
              provider: "panaai",
              apiKey: "pana-test-key",
            },
            activation: "enabled",
          })
          expect(yield* providers.get(Provider.ID.make("openai"))).toBeUndefined()
          const listed = yield* integrations.list()
          expect(listed.map((item) => String(item.id))).toEqual(["panaai"])
          expect(listed[0]?.methods.some((method) => method.type === "key")).toBe(true)
          expect(requests.some((item) => item.path.endsWith("/models"))).toBe(true)
          expect(requests.find((item) => item.path.endsWith("/models"))?.authorization).toBe("Bearer pana-test-key")
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )
})
