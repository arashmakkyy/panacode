import { Effect, Option, Schema, Stream } from "effect"
import { Route } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { Framing } from "../route/framing.js"
import { Protocol } from "../route/protocol.js"
import { AIError, InvalidProviderOutputError, type LLMRequest } from "../schema/index.js"
import * as OpenAIChat from "./openai-chat.js"
import { ProviderShared } from "./shared.js"

const ADAPTER = "panaai-chat"

/**
 * OpenAI Chat Completions with `stream: false`. PanaAI settlement does not
 * support streaming yet, so the request body is forced non-stream and the JSON
 * completion is rewritten into synthetic SSE chunk frames the OpenAI Chat
 * protocol already understands.
 */
const fromRequest = Effect.fn("PanaAIChat.fromRequest")(function* (request: LLMRequest) {
  const body = yield* OpenAIChat.fromRequest(request)
  const { stream: _stream, stream_options: _streamOptions, ...rest } = body
  return { ...rest, stream: false as const }
})

const Completion = Schema.Struct({
  id: Schema.optional(Schema.String),
  object: Schema.optional(Schema.String),
  created: Schema.optional(Schema.Number),
  model: Schema.optional(Schema.String),
  choices: Schema.optional(
    Schema.Array(
      Schema.Struct({
        index: Schema.optional(Schema.Number),
        message: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
        delta: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
        finish_reason: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  usage: Schema.optional(Schema.Unknown),
})

const deltaKeys = [
  "role",
  "content",
  "refusal",
  "reasoning",
  "reasoning_content",
  "reasoning_text",
  "reasoning_details",
] as const

export function completionToFrames(raw: string): readonly string[] {
  const trimmed = raw.trim()
  const value = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(trimmed)
  if (ProviderShared.isRecord(value) && value.error != null) {
    if (ProviderShared.isRecord(value.error) && typeof value.error.message === "string") return [trimmed]
    throw new Error("PanaAI returned an invalid error response")
  }
  const decoded = Schema.decodeUnknownOption(Completion)(value)
  if (Option.isNone(decoded)) throw new Error("Invalid PanaAI completion")

  const completion = decoded.value
  const choice = completion.choices?.[0]
  if (!choice) throw new Error("PanaAI returned no choices")
  const isChunk = completion.object === "chat.completion.chunk"
  const message = isChunk ? choice.delta : choice.message
  if (!message) throw new Error("PanaAI returned no assistant message")
  const output = deltaKeys.some((key) => {
    const value = message[key]
    return (
      key !== "role" && ((typeof value === "string" && value.length > 0) || (Array.isArray(value) && value.length > 0))
    )
  })
  const calls = message.tool_calls
  if (
    calls != null &&
    (!Array.isArray(calls) ||
      !calls.every(
        (call) =>
          ProviderShared.isRecord(call) &&
          ProviderShared.isRecord(call.function) &&
          typeof call.function.name === "string" &&
          call.function.name.length > 0,
      ))
  )
    throw new Error("PanaAI returned an invalid tool call")
  const finish = choice.finish_reason
  if (
    !output &&
    !(Array.isArray(calls) && calls.length) &&
    finish !== "length" &&
    finish !== "content_filter" &&
    finish !== "error"
  )
    throw new Error("PanaAI returned no assistant output")
  if (isChunk) return [trimmed, "[DONE]"]
  const delta: Record<string, unknown> = {}
  for (const key of deltaKeys) {
    if (message[key] !== undefined) delta[key] = message[key]
  }
  if (Array.isArray(message.tool_calls)) {
    delta.tool_calls = message.tool_calls.map((call, index) =>
      ProviderShared.isRecord(call) ? { index, ...call } : { index },
    )
  }
  const chunk = {
    id: completion.id,
    object: "chat.completion.chunk",
    created: completion.created,
    model: completion.model,
    choices: [
      {
        index: choice?.index ?? 0,
        delta,
        finish_reason: choice?.finish_reason ?? "stop",
      },
    ],
    ...(completion.usage !== undefined ? { usage: completion.usage } : {}),
  }
  return [JSON.stringify(chunk), "[DONE]"]
}

export const framing: Framing.Definition<string> = {
  id: "panaai-document",
  frame: (bytes) =>
    Framing.document.frame(bytes).pipe(
      Stream.flatMap((document) => {
        try {
          return Stream.fromIterable(completionToFrames(document))
        } catch (cause) {
          return Stream.fail(
            new AIError({
              reason: new InvalidProviderOutputError({
                route: ADAPTER,
                message:
                  cause instanceof Error && cause.message.startsWith("PanaAI")
                    ? cause.message
                    : "Invalid PanaAI completion document",
              }),
            }),
          )
        }
      }),
    ),
}

const { stream: _streamField, stream_options: _streamOptionsField, ...panaaiBodyFields } = OpenAIChat.bodyFields
const PanaAIChatBody = Schema.Struct({
  ...panaaiBodyFields,
  stream: Schema.Literal(false),
})

export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: PanaAIChatBody,
    from: fromRequest,
  },
  stream: OpenAIChat.protocol.stream,
})

export const route = Route.make({
  id: ADAPTER,
  provider: "panaai",
  providerMetadataKey: "openai",
  protocol,
  endpoint: Endpoint.path("/chat/completions"),
  framing,
})

export * as PanaAIChat from "./panaai-chat.js"
