import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Product } from "@opencode/core/panacode/product"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PanacodeOverlayPlugin } from "@opencode/core/plugin/panacode-overlay"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import {
  connectAuthorizeURL,
  credentialFromExchange,
  PanaAIPlugin,
} from "@opencode/core/plugin/provider/panaai"
import { Rpc } from "@opencode/core/rpc"
import { Provider } from "@opencode/core/provider"
import { Document, Event, Info } from "@opencode/schema/config"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { eventually } from "../lib/eventually"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(Layer.merge(PluginTestLayer, Config.testLayer()))
const decode = Schema.decodeUnknownSync(Info)
const integrationID = Integration.ID.make("panaai")
const methodID = Integration.MethodID.make("browser")

const addPlugins = Effect.fn(function* (http?: HttpClient.HttpClient) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, "test")
  const effect = PanaAIPlugin.effect(host)
  yield* http ? effect.pipe(Effect.provideService(HttpClient.HttpClient, http)) : effect
  yield* PanacodeOverlayPlugin.effect(host)
})

describe("PanaAIPlugin", () => {
  test("builds the connect authorize URL with encoded loopback redirect", () => {
    const url = new URL(
      connectAuthorizeURL({
        authURL: Product.provider.authURL,
        state: "state-token",
        redirectURI: "http://127.0.0.1:54321/callback",
      }),
    )
    expect(url.origin + url.pathname).toBe("https://panaai-psi.vercel.app/connect/panacode")
    expect(url.searchParams.get("state")).toBe("state-token")
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:54321/callback")
  })

  test("maps exchange secret to OAuth access and optional metadata", () => {
    expect(credentialFromExchange({ secret: "pana-secret" })).toEqual(
      Credential.OAuth.make({
        type: "oauth",
        methodID,
        access: "pana-secret",
        refresh: "",
        expires: 0,
      }),
    )
    expect(
      credentialFromExchange({
        secret: "pana-secret",
        baseURL: "https://panaai-psi.vercel.app/v1",
        keyId: "key_1",
        prefix: "pana",
        name: "Workspace",
      }),
    ).toEqual(
      Credential.OAuth.make({
        type: "oauth",
        methodID,
        access: "pana-secret",
        refresh: "",
        expires: 0,
        metadata: {
          baseURL: "https://panaai-psi.vercel.app/v1",
          keyId: "key_1",
          prefix: "pana",
          name: "Workspace",
        },
      }),
    )
  })

  it.effect("registers as a built-in provider plugin with product defaults", () =>
    Effect.sync(() => {
      expect(PanaAIPlugin.id).toBe("opencode.provider.panaai")
      expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.panaai")
      expect(Product.provider.id).toBe("panaai")
      expect(Product.provider.authURL).toBe("https://panaai-psi.vercel.app")
      expect(Product.provider.stream).toBe(false)
      expect(Product.connectAllowlist).toEqual(["panaai"])
    }),
  )

  it.effect("registers Sign in with PanaAI before key paste and env methods", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      yield* addPlugins()
      expect((yield* integrations.get(integrationID))?.methods).toEqual([
        { id: methodID, type: "oauth", label: "Sign in with PanaAI" },
        { type: "key", label: "Paste pana-… platform API key" },
        { type: "env", names: ["PANAAI_API_KEY"] },
      ])
    }),
  )

  it.effect("a failed initial catalog can recover immediately and caches only a validated success", () =>
    Effect.gen(function* () {
      const config = yield* Config.Test
      const integrations = yield* Integration.Service
      const rpc = yield* Rpc.Service
      const key = "fixture-catalog"
      yield* config.setEntries([new Document({ type: "document", info: decode({ providers: { panaai: {
        settings: { baseURL: "https://catalog-recovery.test/v1", apiKey: key },
      } } }) })])
      let requests = 0
      let status = 503
      let ids = ["recovered"]
      const http = HttpClient.make((request) => Effect.sync(() => {
        requests++
        return HttpClientResponse.fromWeb(request, status === 200
          ? Response.json({ data: ids.map((id) => ({ id })) })
          : new Response("", { status }))
      }))
      yield* addPlugins(http)
      const catalog = integrations.get(integrationID).pipe(Effect.map((item) => item?.metadata?.modelCatalog))
      yield* eventually(catalog, (status) => status === "unavailable")
      status = 200
      yield* rpc.call("opencode.provider.panaai", "refresh", {})
      expect(yield* catalog).toBe("ready")
      yield* rpc.call("opencode.provider.panaai", "refresh", {})
      expect(requests).toBe(2)
      const modelState = yield* Model.Service
      const current = modelState.get(Provider.ID.make("panaai"), Model.ID.make("recovered"))
      expect(yield* current).toBeDefined()
      status = 503
      yield* TestClock.adjust("31 seconds")
      yield* eventually(catalog, (value) => value === "unavailable")
      expect(yield* current).toBeDefined()
      status = 401
      yield* rpc.call("opencode.provider.panaai", "refresh", {})
      expect(yield* catalog).toBe("unauthorized")
      expect(yield* current).toBeUndefined()
      status = 200
      ids = []
      yield* rpc.call("opencode.provider.panaai", "refresh", {})
      expect(yield* catalog).toBe("ready")
      expect(yield* current).toBeUndefined()
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
          expect(listed[0]?.methods[0]).toMatchObject({ type: "oauth", label: "Sign in with PanaAI" })
          expect(listed[0]?.methods.some((method) => method.type === "key")).toBe(true)
          expect(requests.some((item) => item.path.endsWith("/models"))).toBe(true)
          expect(requests.find((item) => item.path.endsWith("/models"))?.authorization).toBe("Bearer pana-test-key")
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("discovers models with oauth.access as the bearer token", () =>
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
                data: [{ id: "pana-oauth", object: "model", owned_by: "panaai" }],
              })
            },
          }),
        }
      }),
      ({ requests, server }) =>
        Effect.gen(function* () {
          const bus = yield* Bus.Service
          const config = yield* Config.Test
          const credentials = yield* Credential.Service
          const modelState = yield* Model.Service
          const providerID = Provider.ID.make("panaai")
          const baseURL = `${server.url.origin}/v1`
          yield* config.setEntries([
            new Document({
              type: "document",
              info: decode({ providers: { panaai: { settings: { baseURL } } } }),
            }),
          ])
          yield* credentials.create({
            integrationID,
            value: Credential.OAuth.make({
              type: "oauth",
              methodID,
              access: "pana-from-oauth",
              refresh: "",
              expires: 0,
            }),
          })
          yield* addPlugins()
          yield* bus.publish(Event.Updated, {})
          yield* eventually(modelState.get(providerID, Model.ID.make("pana-oauth")), (model) => model !== undefined)
          expect(requests.find((item) => item.path.endsWith("/models"))?.authorization).toBe("Bearer pana-from-oauth")
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("exchanges a loopback code for a PanaAI secret credential", () =>
    Effect.gen(function* () {
      const requests: Request[] = []
      const replies: Response[] = []
      const http = HttpClient.make((request) =>
        Effect.gen(function* () {
          requests.push(yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie))
          const response = replies.shift()
          if (!response) throw new Error(`Unexpected request: ${request.url}`)
          return HttpClientResponse.fromWeb(request, response)
        }),
      )
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      yield* addPlugins(http)
      const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
      const url = new URL(attempt.url)
      expect(attempt.mode).toBe("auto")
      expect(url.origin + url.pathname).toBe(`${Product.provider.authURL}/connect/panacode`)
      expect(url.searchParams.get("state")).toBeTruthy()
      const redirect = new URL(url.searchParams.get("redirect_uri") ?? "")
      expect(redirect.hostname).toBe("127.0.0.1")
      expect(redirect.pathname).toBe("/callback")
      expect(Number(redirect.port)).toBeGreaterThan(0)

      replies.push(
        Response.json({
          secret: "pana-exchanged",
          keyId: "key_abc",
          prefix: "pana",
          name: "Demo workspace",
        }),
      )
      redirect.searchParams.set("state", url.searchParams.get("state") ?? "")
      redirect.searchParams.set("code", "one-time-code")
      expect((yield* Effect.promise(() => fetch(redirect, { headers: { Connection: "close" } }))).status).toBe(200)
      expect(
        (
          yield* integrations.oauth.status({ integrationID, attemptID: attempt.attemptID }).pipe(
            Effect.repeat({
              until: (value) => value.status !== "pending",
              schedule: Schedule.spaced("1 millis"),
              times: 100,
            }),
          )
        ).status,
      ).toBe("complete")

      const exchange = requests.find((request) =>
        request.url.endsWith("/api/v1/connect/panacode/exchange"),
      )
      expect(exchange?.url).toBe(`${Product.provider.authURL}/api/v1/connect/panacode/exchange`)
      expect(exchange?.headers.get("content-type")).toContain("application/json")
      expect(JSON.parse(yield* Effect.promise(() => exchange!.text()))).toEqual({
        code: "one-time-code",
        state: url.searchParams.get("state"),
      })

      const saved = (yield* credentials.list(integrationID))[0]
      expect(saved?.label).toBe("Demo workspace")
      expect(saved?.value).toEqual(
        Credential.OAuth.make({
          type: "oauth",
          methodID,
          access: "pana-exchanged",
          refresh: "",
          expires: 0,
          metadata: { keyId: "key_abc", prefix: "pana", name: "Demo workspace" },
        }),
      )
    }),
  )

  it.live("completes connect from a pasted redirect when loopback is unreachable", () =>
    Effect.gen(function* () {
      const requests: Request[] = []
      const replies: Response[] = []
      const http = HttpClient.make((request) =>
        Effect.gen(function* () {
          requests.push(yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie))
          const response = replies.shift()
          if (!response) throw new Error(`Unexpected request: ${request.url}`)
          return HttpClientResponse.fromWeb(request, response)
        }),
      )
      const integrations = yield* Integration.Service
      yield* addPlugins(http)
      const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
      const url = new URL(attempt.url)
      const pasted = new URL(url.searchParams.get("redirect_uri") ?? "")
      pasted.searchParams.set("state", url.searchParams.get("state") ?? "")
      pasted.searchParams.set("code", "pasted-code")

      const foreign = new URL(pasted)
      foreign.searchParams.set("state", "other-login")
      expect(
        yield* integrations.oauth
          .complete({ integrationID, attemptID: attempt.attemptID, code: foreign.href })
          .pipe(Effect.flip),
      ).toMatchObject({ cause: { message: "This URL belongs to a different sign-in" } })
      expect((yield* integrations.oauth.status({ integrationID, attemptID: attempt.attemptID })).status).toBe("pending")

      replies.push(Response.json({ secret: "pana-pasted" }))
      yield* integrations.oauth.complete({ integrationID, attemptID: attempt.attemptID, code: pasted.href })
      expect(
        (
          yield* integrations.oauth.status({ integrationID, attemptID: attempt.attemptID }).pipe(
            Effect.repeat({
              until: (value) => value.status !== "pending",
              schedule: Schedule.spaced("1 millis"),
              times: 100,
            }),
          )
        ).status,
      ).toBe("complete")
      expect(JSON.parse(yield* Effect.promise(() => requests[0]!.text()))).toMatchObject({ code: "pasted-code" })
    }),
  )
})
