import { Config } from "effect"

// Every environment variable the CLI reads, in one place. Consumers yield
// these instead of touching process.env so the full surface stays visible,
// typed, and redacted where secret. Panacode never falls back to OPENCODE_*.

export const password = Config.Redacted("PANACODE_PASSWORD").pipe(
  Config.orElse(() => Config.Redacted("PANACODE_SERVER_PASSWORD")),
  Config.withDefault(undefined),
)

const secretKeys = new Set([
  "PANACODE_PASSWORD",
  "PANACODE_SERVER_PASSWORD",
  // A hostile inherited value must not reach a shell either.
  "OPENCODE_PASSWORD",
  "OPENCODE_SERVER_PASSWORD",
])

export function session() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !secretKeys.has(entry[0]) && !entry[0].toUpperCase().startsWith("OPENCODE_"),
    ),
  )
}

export * as Env from "./env"
