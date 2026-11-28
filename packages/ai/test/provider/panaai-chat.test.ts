import { describe, expect, test } from "bun:test"
import { Effect, Ref, Schema, Stream } from "effect"
import { ai } from "../../src/effect.js"
import { Auth, LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { completionToFrames, framing, route } from "../../src/protocols/panaai-chat.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"

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

  test.each([
    "",
    "not JSON",
    "{}",
    '{"choices":[]}',
    '{"choices":[{"message":{"role":"assistant"}}]}',
    '{"choices":[{"message":{"content":""}}]}',
    '{"choices":[{"message":{"tool_calls":[{}]}}]}',
    '{"object":"chat.completion.chunk","choices":[{}]}',
  ])("rejects incomplete completion %j", (body) => expect(() => completionToFrames(body)).toThrow())
  test("passes provider errors to the protocol and preserves genuine length stops", () => {
    const error = JSON.stringify({ error: { code: 429, message: "quota exhausted" } })
    expect(completionToFrames(error)).toEqual([error])
    const [chunk] = completionToFrames(
      JSON.stringify({ choices: [{ message: { content: "half" }, finish_reason: "length" }] }),
    )
    expect(JSON.parse(chunk!).choices[0]).toMatchObject({ delta: { content: "half" }, finish_reason: "length" })
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

  for (const body of ["{}", '{"choices":[]}', '{"error":{"message":"catalog temporarily unavailable"}}']) {
    it.effect("propagates the HTTP 200 failure " + body, () =>
      Effect.gen(function* () {
        const model = route
          .with({
            auth: Auth.bearer("fixture"),
            endpoint: { baseURL: "https://panaai.test/v1" },
          })
          .model({ id: "demo" })
        const events: string[] = []
        const error = yield* LLMClient.stream(ai.request({ model, prompt: "hello" })).pipe(
          Stream.tap((event) =>
            Effect.sync(() => {
              events.push(event.type)
            }),
          ),
          Stream.runDrain,
          Effect.provide(
            dynamicResponse((input) => Effect.succeed(input.respond(body, { headers: { "content-type": "application/json" } }))),
          ),
          Effect.flip,
        )
        if (body.includes("temporarily unavailable")) expect(error.message).toContain("catalog temporarily unavailable")
        else expect(error.reason._tag).toBe("InvalidProviderOutput")
        expect(events).not.toContain("text-delta")
      }),
    )
  }

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
