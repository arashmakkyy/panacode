import { expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { Env } from "../src/env"

test("session environment keeps Panacode values and omits server credentials", () => {
  const values = {
    PANACODE_PASSWORD: "password",
    PANACODE_SERVER_PASSWORD: "legacy",
    PANACODE_SESSION_ENV_TEST: "included",
    PANACODE_CONFIG_CONTENT: '{"shell":"stored-override"}',
    pAnAcOdE_SeRvIcE_PrOoF_KeY: "per-launch",
    panacode_pty_handoff: "ticket",
    OPENCODE_SESSION_ENV_TEST: "ambient",
    opencode_db: "/tmp/opencode.db",
    OPENCODE_PASSWORD: "upstream-password",
    OPENCODE_CONFIG_CONTENT: '{"shell":"upstream-override"}',
  }
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
  Object.assign(process.env, values)
  const environment = Env.session()
  restore(previous)

  expect(environment.PANACODE_PASSWORD).toBeUndefined()
  expect(environment.PANACODE_SERVER_PASSWORD).toBeUndefined()
  expect(environment.pAnAcOdE_SeRvIcE_PrOoF_KeY).toBeUndefined()
  expect(environment.panacode_pty_handoff).toBeUndefined()
  expect(environment.PANACODE_SESSION_ENV_TEST).toBe("included")
  expect(environment.PANACODE_CONFIG_CONTENT).toBe('{"shell":"stored-override"}')
  expect(environment.OPENCODE_SESSION_ENV_TEST).toBeUndefined()
  expect(environment.opencode_db).toBeUndefined()
  expect(environment.OPENCODE_PASSWORD).toBeUndefined()
  expect(environment.OPENCODE_CONFIG_CONTENT).toBeUndefined()
})

function restore(previous: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}
test("the running server retains its credential without passing launch secrets to native children", async () => {
  const names = ["PANACODE_PASSWORD", "PANACODE_SERVER_PASSWORD", "PANACODE_PTY_HANDOFF", "PANACODE_SERVICE_PROOF_KEY"]
  const previous = Object.fromEntries(names.map((key) => [key, process.env[key]]))
  try {
    for (const name of names) process.env[name] = "private-value"
    const captured = await Effect.runPromise(Env.consumeServerPassword)
    expect(captured && Redacted.value(captured)).toBe("private-value")
    for (const name of names) expect(process.env[name]).toBeUndefined()
  } finally {
    restore(previous)
  }
})
