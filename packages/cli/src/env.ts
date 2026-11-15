import { Config } from "effect"
import "./product-env-bootstrap"

// Every environment variable the CLI reads, in one place. Consumers yield
// these instead of touching process.env so the full surface stays visible,
// typed, and redacted where secret.

// Prefer PANACODE_* (synced onto OPENCODE_* at bootstrap). Legacy
// OPENCODE_SERVER_PASSWORD is still honored.
export const password = Config.Redacted("OPENCODE_PASSWORD").pipe(
  Config.orElse(() => Config.Redacted("OPENCODE_SERVER_PASSWORD")),
  Config.withDefault(undefined),
)

const secretKeys = new Set([
  "OPENCODE_PASSWORD",
  "OPENCODE_SERVER_PASSWORD",
  "PANACODE_PASSWORD",
  "PANACODE_SERVER_PASSWORD",
])

export function session() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !secretKeys.has(entry[0]),
    ),
  )
}

export * as Env from "./env"
