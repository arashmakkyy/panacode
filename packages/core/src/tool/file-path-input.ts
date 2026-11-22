import { Tool } from "@opencode/schema/tool"
import { isRecord } from "@opencode/util/record"
import { Option, Schema } from "effect"

const schemas = new WeakSet<object>()
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

/** Opt in only the native file tools. A plugin can register another tool with the same name. */
export function filePathInput<T extends object>(schema: T) {
  schemas.add(schema)
  return schema
}

export function normalizeFilePath(schema: object | undefined, input: unknown) {
  if (!schema || !schemas.has(schema)) return input
  const value = typeof input === "string" ? Option.getOrUndefined(decodeJson(input)) : input
  if (!isRecord(value)) return input
  const aliases = ["filePath", "file_path", "file"].filter((key) => Object.hasOwn(value, key))
  if (aliases.length === 0) {
    if (typeof value.path === "string" && !value.path.trim())
      return new Tool.InputError({ message: "Provide a nonempty path to the intended target. No file was accessed." })
    return value
  }
  const target = Object.hasOwn(value, "path") ? value.path : value[aliases[0]!]
  if (typeof target !== "string" || !target.trim() || aliases.some((key) => value[key] !== target)) {
    return new Tool.InputError({ message: "Provide one explicit file path in the required path field. The supplied file path arguments are invalid or disagree. No file was accessed." })
  }
  const result: Record<string, unknown> = { ...value, path: target }
  for (const alias of aliases) delete result[alias]
  return result
}
