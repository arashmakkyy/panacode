import { expect, test } from "bun:test"
import { Env } from "../src/env"

test("session environment keeps Panacode values and omits server credentials", () => {
  const previousPassword = process.env.PANACODE_PASSWORD
  const previousLegacyPassword = process.env.PANACODE_SERVER_PASSWORD
  const previousValue = process.env.PANACODE_SESSION_ENV_TEST
  const previousAmbient = process.env.OPENCODE_SESSION_ENV_TEST
  process.env.PANACODE_PASSWORD = "password"
  process.env.PANACODE_SERVER_PASSWORD = "legacy"
  process.env.PANACODE_SESSION_ENV_TEST = "included"
  process.env.OPENCODE_SESSION_ENV_TEST = "ambient"

  const environment = Env.session()

  if (previousPassword === undefined) delete process.env.PANACODE_PASSWORD
  else process.env.PANACODE_PASSWORD = previousPassword
  if (previousLegacyPassword === undefined) delete process.env.PANACODE_SERVER_PASSWORD
  else process.env.PANACODE_SERVER_PASSWORD = previousLegacyPassword
  if (previousValue === undefined) delete process.env.PANACODE_SESSION_ENV_TEST
  else process.env.PANACODE_SESSION_ENV_TEST = previousValue
  if (previousAmbient === undefined) delete process.env.OPENCODE_SESSION_ENV_TEST
  else process.env.OPENCODE_SESSION_ENV_TEST = previousAmbient

  expect(environment.PANACODE_PASSWORD).toBeUndefined()
  expect(environment.PANACODE_SERVER_PASSWORD).toBeUndefined()
  expect(environment.PANACODE_SESSION_ENV_TEST).toBe("included")
  expect(environment.OPENCODE_SESSION_ENV_TEST).toBeUndefined()
})