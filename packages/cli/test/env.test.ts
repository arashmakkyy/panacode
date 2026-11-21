import { expect, test } from "bun:test"
import { Env } from "../src/env"

test("session environment keeps Panacode values and omits server credentials", () => {
  const previous = {
    password: process.env.PANACODE_PASSWORD,
    legacyPassword: process.env.PANACODE_SERVER_PASSWORD,
    value: process.env.PANACODE_SESSION_ENV_TEST,
    override: process.env.PANACODE_CONFIG_CONTENT,
    ambient: process.env.OPENCODE_SESSION_ENV_TEST,
    ambientDB: process.env.opencode_db,
    ambientPassword: process.env.OPENCODE_PASSWORD,
    ambientContent: process.env.OPENCODE_CONFIG_CONTENT,
  }
  process.env.PANACODE_PASSWORD = "password"
  process.env.PANACODE_SERVER_PASSWORD = "legacy"
  process.env.PANACODE_SESSION_ENV_TEST = "included"
  process.env.PANACODE_CONFIG_CONTENT = '{"shell":"stored-override"}'
  process.env.OPENCODE_SESSION_ENV_TEST = "ambient"
  process.env.opencode_db = "/tmp/opencode.db"
  process.env.OPENCODE_PASSWORD = "upstream-password"
  process.env.OPENCODE_CONFIG_CONTENT = '{"shell":"upstream-override"}'

  const environment = Env.session()

  restore(previous)

  expect(environment.PANACODE_PASSWORD).toBeUndefined()
  expect(environment.PANACODE_SERVER_PASSWORD).toBeUndefined()
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