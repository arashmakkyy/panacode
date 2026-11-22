import { Effect, Option, Schema, Stream } from "effect"
import { Route } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { Framing } from "../route/framing.js"
import { Protocol } from "../route/protocol.js"
import type { LLMRequest } from "../schema/index.js"
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
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    throw new Error("PanaAI returned an invalid JSON completion.")
  }
  if (!ProviderShared.isRecord(value)) throw new Error("PanaAI returned an invalid completion envelope.")
  if (value.error != null) {
    // Some gateways return a normal OpenAI error envelope with HTTP 200.
    if (typeof value.error === "string") return [JSON.stringify({ error: { message: value.error } }), "[DONE]"]
    if (!ProviderShared.isRecord(value.error) || typeof value.error.message !== "string")
      throw new Error("PanaAI returned an invalid error envelope.")
    return [JSON.stringify({ error: value.error }), "[DONE]"]
  }
  const decoded = Schema.decodeUnknownOption(Completion)(value)
  if (Option.isNone(decoded)) throw new Error("PanaAI returned an invalid completion envelope.")
  const completion = decoded.value
  const isChunk = completion.object === "chat.completion.chunk"
  const choice = completion.choices?.[0]
  if (!choice || !choice.finish_reason) throw new Error("PanaAI returned no completed choice with a finish reason.")
  const supplied = isChunk ? choice.delta : choice.message
  if (!supplied && choice.finish_reason !== "content_filter")
    throw new Error("PanaAI returned a choice without an assistant message.")
  const message = supplied ?? {}
  const delta: Record<string, unknown> = {}
  for (const key of deltaKeys) {
    if (message[key] !== undefined) delta[key] = message[key]
  }
  if (message.tool_calls != null) {
    if (!Array.isArray(message.tool_calls)) throw new Error("PanaAI returned an invalid tool call list.")
    const seen = new Set<string>()
    delta.tool_calls = message.tool_calls.map((call, index) => {
      if (!ProviderShared.isRecord(call) || typeof call.id !== "string" || !call.id.trim() || seen.has(call.id))
        throw new Error("PanaAI returned a tool call without a unique ID.")
      seen.add(call.id)
      if (call.type === "custom" || call.custom != null) {
        const custom = call.custom
        if (!ProviderShared.isRecord(custom) || typeof custom.name !== "string" || !custom.name.trim() || typeof custom.input !== "string")
          throw new Error("PanaAI returned an incomplete custom tool call.")
        return { ...call, index }
      }
      const fn = call.function
      if (!ProviderShared.isRecord(fn) || typeof fn.name !== "string" || !fn.name.trim())
        throw new Error("PanaAI returned a tool call without a function name.")
      if (typeof fn.arguments === "string") return { ...call, index }
      // A few compatible gateways already decoded the arguments. Do not try to close or unescape malformed JSON text.
      if (!ProviderShared.isRecord(fn.arguments)) throw new Error("PanaAI returned a tool call without arguments.")
      return { ...call, index, function: { ...fn, arguments: JSON.stringify(fn.arguments) } }
    })
  }
  const hasCalls = Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0
  if (choice.finish_reason === "tool_calls" && !hasCalls)
    throw new Error("PanaAI reported tool calls without supplying any calls.")
  const answer = [message.content, message.refusal].some((value) => typeof value === "string" && value.trim().length > 0)
  if (choice.finish_reason === "stop" && !hasCalls && !answer)
    throw new Error("PanaAI returned an empty assistant response.")
  if (isChunk && Array.isArray(value.choices)) {
    // Preserve vendor-specific chunk metadata while using the checked, indexed calls.
    return [JSON.stringify({ ...value, choices: [{ ...value.choices[0], delta: { ...message, ...delta } }] }), "[DONE]"]
  }
  const chunk = {
    id: completion.id,
    object: "chat.completion.chunk",
    created: completion.created,
    model: completion.model,
    choices: [
      {
        index: choice.index ?? 0,
        delta,
        finish_reason: choice.finish_reason,
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
          const message = cause instanceof Error ? cause.message : "PanaAI returned an invalid completion."
          return Stream.fail(ProviderShared.eventError(ADAPTER, message))
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
