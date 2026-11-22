import { describe, expect, test } from "bun:test"
import { Effect, Ref, Schema, Stream } from "effect"
import { ai } from "../../src/effect.js"
import { Auth, LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { completionToFrames, framing, route } from "../../src/protocols/panaai-chat.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, fixedResponse } from "../lib/http.js"

const Json = Schema.fromJsonString(Schema.Unknown)
const decodeJson = Schema.decodeUnknownSync(Json)

describe("PanaAIChat", () => {
  test("rewrites a non-stream chat.completion into synthetic chunk frames", () => {
    const frames = completionToFrames(
      JSON.stringify({
        id: "chatcmpl_1",
        object: "chat.completion",
        created: 1,
        model: "demo",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "hello" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    )
    expect(frames).toHaveLength(2)
    expect(frames[1]).toBe("[DONE]")
    expect(JSON.parse(frames[0]!)).toMatchObject({
      id: "chatcmpl_1",
      object: "chat.completion.chunk",
      model: "demo",
      choices: [{ index: 0, delta: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
  })

  test("indexes tool_calls on the synthetic delta", () => {
    const frames = completionToFrames(
      JSON.stringify({
        object: "chat.completion",
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    )
    expect(JSON.parse(frames[0]!)).toMatchObject({
      choices: [
        {
          finish_reason: "tool_calls",
          delta: {
            role: "assistant",
            tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }],
          },
        },
      ],
    })
  })

  const model = route.with({
    auth: Auth.bearer("pana-test"),
    endpoint: { baseURL: "https://panaai.test/v1" },
  }).model({ id: "deepseek-fixture" })
  const request = ai.request({ model, prompt: "یک لندینگ‌پیج فارسی بساز" })
  const respond = (body: string) => fixedResponse(body, { headers: { "content-type": "application/json" } })

  it.effect("keeps HTTP 200 error envelopes and rejects incomplete documents instead of reporting success", () =>
    Effect.gen(function* () {
      const provider = yield* LLMClient.generate(request).pipe(
        Effect.provide(respond(JSON.stringify({ error: { code: 413, message: "حجم درخواست بیش از حد مجاز است." } }))), Effect.flip,
      )
      expect(provider.reason).toMatchObject({ message: expect.stringContaining("حجم درخواست"), classification: "payload-too-large" })
      for (const raw of ["", "[DONE]", "{broken PRIVATE_DOCUMENT_BYTES", "{}", "null", '{"choices":[]}', '{"error":true}',
        '{"choices":[{"finish_reason":"tool_calls","message":{"tool_calls":[{"id":"call"}]}}]}',
        '{"choices":[{"finish_reason":"tool_calls","message":{"tool_calls":[{"function":{"name":"write","arguments":"{}"}}]}}]}',
        '{"object":"chat.completion.chunk","choices":[{"finish_reason":"stop","delta":{"reasoning":"only"}}]}',
        '{"choices":[{"message":{"role":"assistant","content":"partial"}}]}',
        '{"choices":[{"finish_reason":"stop","message":{"role":"assistant"}}]}',
        '{"choices":[{"finish_reason":"stop","message":{"content":"  ","reasoning_content":"I should start writing"}}]}',
        '{"choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","tool_calls":[]}}]}',
      ]) {
        const error = yield* LLMClient.generate(request).pipe(Effect.provide(respond(raw)), Effect.flip)
        expect(error.reason._tag).toBe("InvalidProviderOutput")
        expect(JSON.stringify(error.reason)).not.toContain("PRIVATE_DOCUMENT_BYTES")
      }
    }),
  )

  it.effect("delivers a complete large RTL file and reports malformed argument text without executing it", () =>
    Effect.gen(function* () {
      const content = '<!doctype html><html lang="fa" dir="rtl">' + "از ابزار استفاده کن. ".repeat(1700) + "</html>"
      const input = { content, filePath: "landing-page/index.html" }
      const malformed = JSON.stringify(input).slice(0, -3)
      const body = JSON.stringify({
        choices: [{ index: 0, finish_reason: "tool_calls", message: {
          role: "assistant", content: null, tool_calls: [
            { id: "good-text", type: "function", function: { name: "write", arguments: JSON.stringify(input) } },
            { id: "bad-text", type: "function", function: { name: "write", arguments: malformed } },
            { id: "good-object", type: "function", function: { name: "write", arguments: input } },
          ],
        } }],
      })
      const events = Array.from(yield* LLMClient.stream(request).pipe(Stream.runCollect, Effect.provide(respond(body))))
      expect(events.filter((event) => event.type === "tool-call").map((call) => [call.id, call.input])).toEqual([
        ["good-text", input], ["good-object", input],
      ])
      expect(events.filter((event) => event.type === "tool-input-error").map((call) => [call.id, call.raw])).toEqual([
        ["bad-text", malformed],
      ])
    }),
  )

  it.effect("forces stream:false on the request body", () =>
    Effect.gen(function* () {
      const model = route
        .with({
          auth: Auth.bearer("pana-test"),
          endpoint: { baseURL: "https://panaai.test/v1" },
        })
        .model({ id: "demo" })
      const prepared = yield* compileRequest(ai.request({ model, prompt: "hi", maxTokens: 16 }))
      expect(prepared.body).toMatchObject({ model: "demo", stream: false })
      expect(prepared.body).not.toHaveProperty("stream_options")
    }),
  )

  it.effect("accepts a JSON completion response through document framing", () =>
    Effect.gen(function* () {
      const model = route
        .with({
          auth: Auth.bearer("pana-test"),
          endpoint: { baseURL: "https://panaai.test/v1" },
        })
        .model({ id: "demo" })
      const events = yield* Ref.make<string[]>([])
      yield* LLMClient.stream(ai.request({ model, prompt: "hi", maxTokens: 16 })).pipe(
        Stream.tap((event) =>
          event.type === "text-delta" ? Ref.update(events, (items) => [...items, event.text]) : Effect.void,
        ),
        Stream.runDrain,
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              expect(decodeJson(input.text)).toMatchObject({ stream: false })
              expect(framing.id).toBe("panaai-document")
              return input.respond(
                JSON.stringify({
                  id: "chatcmpl_live",
                  object: "chat.completion",
                  choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
                }),
                { headers: { "content-type": "application/json" } },
              )
            }),
          ),
        ),
      )
      expect(yield* Ref.get(events)).toEqual(["ok"])
    }),
  )
})
