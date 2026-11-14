import { define } from "@opencode/plugin/effect/plugin"
import type { Entry } from "@opencode/schema/config"
import { Deferred, Duration, Effect, FiberSet, Option, Schedule, Schema, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import type { ServerResponse } from "node:http"
import { Config } from "../../config.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { Model } from "../../model.js"
import { OauthCallbackPage } from "../../oauth/page.js"
import { OauthRedirect } from "../../oauth/redirect.js"
import { Product } from "../../panacode/product.js"
import { Provider } from "../../provider.js"
import { foldSettings } from "./configured.js"
import { activeCredential } from "./credential-settings.js"
import { ProviderRefresh } from "./refresh.js"

const providerID = Provider.ID.make(Product.provider.id)
const integrationID = Integration.ID.make(Product.provider.id)
const methodID = Integration.MethodID.make("browser")
const requestTimeout = "15 seconds"
const defaultBaseURL = Product.provider.baseURL
const authURL = Product.provider.authURL

const RemoteModel = Schema.Struct({
  id: Schema.String,
  object: Schema.optional(Schema.String),
  owned_by: Schema.optional(Schema.String),
})
const Response = Schema.Struct({ data: Schema.Array(RemoteModel) })
const Exchange = Schema.Struct({
  secret: Schema.String.check(Schema.isNonEmpty()),
  baseURL: Schema.optional(Schema.String),
  keyId: Schema.optional(Schema.String),
  prefix: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
})
const decodeExchangeError = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ error: Schema.optional(Schema.String), error_description: Schema.optional(Schema.String) }),
  ),
)

type Discovered = typeof RemoteModel.Type

const discovery = new Map<string, { checked: number; apiKey?: string; models?: readonly Discovered[] }>()
const discoveryLocks = new Map<string, Semaphore.Semaphore>()

export const PanaAIPlugin = define({
  id: "opencode.provider.panaai",
  effect: Effect.fn(function* (ctx) {
    const client = yield* HttpClient.HttpClient
    const http = HttpClient.filterStatusOk(client)
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
        method: { id: methodID, type: "oauth", label: "Sign in with PanaAI" },
        label: (value) => (typeof value.metadata?.name === "string" ? value.metadata.name : undefined),
        authorize: () =>
          Effect.gen(function* () {
            const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
            // `response` is the browser's pending callback request; a pasted redirect has none.
            const callback = yield* Deferred.make<{ code: string; response?: ServerResponse }, Error>()
            const { createServer } = yield* Effect.promise(() => import("node:http"))
            const { EventEmitter } = yield* Effect.promise(() => import("node:events"))
            const server = createServer((request, response) => {
              const url = new URL(request.url ?? "/", "http://127.0.0.1")
              if (request.method !== "GET" || url.pathname !== "/callback") {
                response.writeHead(404).end()
                return
              }
              const error = callbackError(url.searchParams, state)
              if (error) {
                response
                  .writeHead(400, { "Content-Type": "text/html" })
                  .end(OauthCallbackPage.error(error, { provider: Product.provider.name }))
                Effect.runSync(Deferred.fail(callback, new Error(error)))
                return
              }
              if (!Effect.runSync(Deferred.succeed(callback, { code: url.searchParams.get("code") ?? "", response })))
                response.writeHead(409).end("OAuth callback already received")
            })
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                server.close()
                server.closeAllConnections()
              }),
            )
            yield* Effect.tryPromise(() => EventEmitter.once(server.listen(0, "127.0.0.1"), "listening"))
            const address = server.address()
            if (!address || typeof address === "string")
              return yield* Effect.fail(new Error("Missing OAuth callback port"))
            const redirect = `http://127.0.0.1:${address.port}/callback`
            return {
              mode: "auto" as const,
              url: connectAuthorizeURL({ authURL, state, redirectURI: redirect }),
              instructions: "Complete authorization in your browser. This window will close automatically.",
              callback: Effect.gen(function* () {
                const request = yield* Deferred.await(callback)
                const respond = (error?: string) =>
                  Effect.sync(() =>
                    request.response
                      ?.writeHead(error ? 400 : 200, { "Content-Type": "text/html" })
                      .end(
                        error
                          ? OauthCallbackPage.error(error, { provider: Product.provider.name })
                          : OauthCallbackPage.success({ provider: Product.provider.name }),
                      ),
                  )
                return yield* exchangeCode(client, { code: request.code, state }).pipe(
                  Effect.tap(() => respond()),
                  Effect.tapError((error) => respond(error.message)),
                  // Bun's server.closeAllConnections() leaves an unanswered callback response pending.
                  Effect.onInterrupt(() => Effect.sync(() => request.response?.destroy())),
                )
              }),
              submit: OauthRedirect.submit({ state, callback, received: (code) => ({ code }) }),
            }
          }),
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
      const apiKey = apiKeyFrom(active.credential, current.apiKey)
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

/** Builds the system-browser authorize URL for Panacode connect. */
export function connectAuthorizeURL(input: { authURL: string; state: string; redirectURI: string }) {
  return `${input.authURL.replace(/\/+$/, "")}/connect/panacode?${new URLSearchParams({
    state: input.state,
    redirect_uri: input.redirectURI,
  }).toString()}`
}

/** Maps a successful connect exchange payload to a stored OAuth credential (secret → access). */
export function credentialFromExchange(payload: typeof Exchange.Type) {
  const metadata = Object.fromEntries(
    (
      [
        ["baseURL", payload.baseURL],
        ["keyId", payload.keyId],
        ["prefix", payload.prefix],
        ["name", payload.name],
      ] as const
    ).flatMap(([key, value]) => (typeof value === "string" && value.length > 0 ? [[key, value]] : [])),
  )
  return Credential.OAuth.make({
    type: "oauth",
    methodID,
    access: payload.secret,
    refresh: "",
    expires: 0,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  })
}

function apiKeyFrom(credential: Credential.Value | undefined, fallback: string | undefined) {
  if (credential?.type === "key") return credential.key
  if (credential?.type === "oauth") return credential.access
  return fallback
}

function callbackError(params: URLSearchParams, state: string) {
  if (params.get("state") !== state) return "Invalid OAuth state"
  if (params.has("error")) {
    const detail = params.get("error_description") || params.get("error") || "Authorization denied"
    return detail.includes(state) ? "PanaAI authorization failed" : detail
  }
  return params.get("code")?.trim() ? undefined : "Missing authorization code"
}

function exchangeCode(http: HttpClient.HttpClient, input: { code: string; state: string }) {
  return Effect.gen(function* () {
    const response = yield* http
      .execute(
        HttpClientRequest.post(`${authURL.replace(/\/+$/, "")}/api/v1/connect/panacode/exchange`).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.bodyJsonUnsafe({ code: input.code, state: input.state }),
        ),
      )
      .pipe(Effect.mapError(() => new Error("PanaAI connect exchange request failed")))
    if (response.status < 200 || response.status >= 300) {
      const error = Option.getOrUndefined(decodeExchangeError(yield* response.text.pipe(Effect.orElseSucceed(() => ""))))
      const detail = error?.error_description || error?.error
      return yield* Effect.fail(
        new Error(
          detail && ![input.code, input.state].some((secret) => detail.includes(secret))
            ? `PanaAI connect exchange failed: ${detail}`
            : `PanaAI connect exchange failed (${response.status})`,
        ),
      )
    }
    const payload = yield* HttpClientResponse.schemaBodyJson(Exchange)(response).pipe(
      Effect.mapError(() => new Error("Invalid PanaAI connect exchange response")),
    )
    return credentialFromExchange(payload)
  })
}

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
