import { define } from "@opencode/plugin/effect/plugin"
import type { Entry } from "@opencode/schema/config"
import { Duration, Effect, FiberSet, Schedule, Schema, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Config } from "../../config.js"
import { Integration } from "../../integration.js"
import { Model } from "../../model.js"
import { Product } from "../../panacode/product.js"
import { Provider } from "../../provider.js"
import { foldSettings } from "./configured.js"
import { activeCredential } from "./credential-settings.js"
import { ProviderRefresh } from "./refresh.js"

const providerID = Provider.ID.make(Product.provider.id)
const integrationID = Integration.ID.make(Product.provider.id)
const requestTimeout = "15 seconds"
const defaultBaseURL = Product.provider.baseURL

const RemoteModel = Schema.Struct({
  id: Schema.String,
  object: Schema.optional(Schema.String),
  owned_by: Schema.optional(Schema.String),
})
const Response = Schema.Struct({ data: Schema.Array(RemoteModel) })

type Discovered = typeof RemoteModel.Type

const discovery = new Map<string, { checked: number; apiKey?: string; models?: readonly Discovered[] }>()
const discoveryLocks = new Map<string, Semaphore.Semaphore>()

export const PanaAIPlugin = define({
  id: "opencode.provider.panaai",
  effect: Effect.fn(function* (ctx) {
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const config = yield* Config.Service
    const source = { current: configured(yield* config.entries()) }
    const loaded = {
      models: [] as readonly Discovered[],
      connected: false,
      apiKey: undefined as string | undefined,
      hash: "[]",
      failing: false,
    }

    yield* ctx.integration.transform((integrations) => {
      integrations.update(integrationID, (integration) => {
        integration.name = Product.provider.name
      })
      integrations.method.update({
        integrationID,
        method: { type: "key", label: "Paste pana-… platform API key" },
      })
      integrations.method.update({
        integrationID,
        method: { type: "env", names: [...Product.provider.env] },
      })
    })

    yield* ctx.provider.transform((providers) => {
      if (loaded.models.length === 0) return
      for (const model of providers.get(providerID)?.models.values() ?? []) {
        providers.models.remove(providerID, model.id)
      }
      providers.update(providerID, (provider) => {
        provider.name = Product.provider.name
        provider.activation = "enabled"
        provider.package = Product.provider.package
        provider.integrationID = integrationID
        provider.settings = {
          baseURL: source.current.baseURL,
          provider: Product.provider.id,
          apiKey: loaded.apiKey ?? source.current.apiKey ?? "",
        }
      })
      for (const item of loaded.models) {
        providers.models.update(providerID, item.id, (model) => {
          model.modelID = Model.ID.make(item.id)
          model.name = item.id
          model.capabilities = {
            tools: true,
            input: ["text"],
            output: ["text"],
          }
        })
      }
    })

    const discover = Effect.fn("PanaAIPlugin.discover")(function* () {
      const current = source.current
      if (!current.endpoint) return undefined
      const active = yield* activeCredential(ctx, Product.provider.id)
      const connected = active.connection !== undefined
      const apiKey = active.credential?.type === "key" ? active.credential.key : current.apiKey
      if (!apiKey) return { source: current, connected, apiKey: undefined, models: [] as const }
      const lock = discoveryLocks.get(current.baseURL) ?? Semaphore.makeUnsafe(1)
      discoveryLocks.set(current.baseURL, lock)
      return yield* lock.withPermit(
        Effect.gen(function* () {
          const cached = discovery.get(current.baseURL)
          if (cached && cached.apiKey === apiKey && Date.now() - cached.checked < Duration.toMillis("30 seconds"))
            return { source: current, connected, apiKey, models: cached.models ?? [] }
          discovery.set(current.baseURL, {
            checked: Date.now(),
            apiKey,
            models: cached && cached.apiKey === apiKey ? cached.models : undefined,
          })
          const response = yield* http
            .execute(
              HttpClientRequest.get(current.endpoint("/models")).pipe(
                HttpClientRequest.acceptJson,
                HttpClientRequest.bearerToken(apiKey),
              ),
            )
            .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Response)), Effect.timeout(requestTimeout))
          const models = response.data
            .filter((model) => model.id.length > 0)
            .toSorted((a, b) => a.id.localeCompare(b.id))
          discovery.set(current.baseURL, { checked: Date.now(), apiKey, models })
          return { source: current, connected, apiKey, models }
        }),
      )
    })

    const refresh = Effect.fn("PanaAIPlugin.refresh")(function* () {
      const result = yield* discover()
      loaded.failing = false
      if (!result || result.source !== source.current) return
      const hash = JSON.stringify([result.connected, result.apiKey, result.models])
      if (hash === loaded.hash) return
      loaded.models = result.models
      loaded.connected = result.connected
      loaded.apiKey = result.apiKey
      loaded.hash = hash
      yield* ctx.integration.reload()
      yield* ctx.provider.reload()
    })

    const attempt = Effect.suspend(() => {
      const current = source.current
      return refresh().pipe(
        Effect.catch((cause) => {
          if (current !== source.current || loaded.failing) return Effect.void
          loaded.failing = true
          return Effect.logWarning(`failed to discover ${Product.provider.name} models`, {
            baseURL: current.baseURL,
            cause,
          })
        }),
      )
    })
    yield* attempt.pipe(Effect.repeat(Schedule.spaced("30 seconds")), Effect.forkScoped)
    const background = yield* FiberSet.make()
    yield* ProviderRefresh.onSwitch(Product.provider.id, FiberSet.run(background, attempt))
    const reload = Effect.fn("PanaAIPlugin.reload")(function* () {
      const next = configured(yield* config.entries())
      if (next.baseURL === source.current.baseURL && next.apiKey === source.current.apiKey) return
      source.current = next
      loaded.models = []
      loaded.connected = false
      loaded.apiKey = undefined
      loaded.hash = "[]"
      loaded.failing = false
      yield* ctx.integration.reload()
      yield* ctx.provider.reload()
      yield* FiberSet.run(background, attempt)
    })
    yield* ctx.event
      .subscribe({ types: ["config.updated"] })
      .pipe(Stream.runForEach(reload), Effect.forkScoped({ startImmediately: true }))
  }),
})

function configured(entries: readonly Entry[]) {
  const settings = foldSettings(entries, providerID, undefined)
  const baseURL = (typeof settings?.baseURL === "string" ? settings.baseURL : defaultBaseURL).replace(/\/+$/, "")
  const apiKey = typeof settings?.apiKey === "string" ? settings.apiKey : undefined
  if (!URL.canParse(baseURL)) return { baseURL, apiKey }
  const url = new URL(baseURL)
  if (url.protocol !== "http:" && url.protocol !== "https:") return { baseURL, apiKey }
  const root = new URL(/(?:^|\/)v1$/.test(url.pathname.replace(/\/+$/, "")) ? baseURL : `${baseURL}/v1`)
  const endpoint = (path: string) => {
    const next = new URL(root)
    next.pathname = `${next.pathname.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`
    next.search = ""
    next.hash = ""
    return next.toString()
  }
  return { baseURL, apiKey, endpoint }
}
