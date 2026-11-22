import { expect, test } from "bun:test"
import path from "node:path"
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
  // The real CLI's Effect config provider snapshots the environment when the runtime starts.
  const script = `
    import { Effect, Redacted } from "effect"
    import { Env } from "./src/env.ts"
    import { spawnSync } from "node:child_process"
    const value = await Effect.runPromise(Env.consumeServerPassword)
    if (!value || Redacted.value(value) !== "private-value") process.exit(1)
    const check = 'process.exit(["PANACODE_PASSWORD", "PANACODE_SERVER_PASSWORD", "PANACODE_PTY_HANDOFF", "PANACODE_SERVICE_PROOF_KEY"].some(name => process.env[name] !== undefined) ? 2 : 0)'
    process.exit(spawnSync(process.execPath, ["-e", check], { env: process.env }).status ?? 3)
  `
  const child = Bun.spawn([process.execPath, "-e", script], {
    cwd: path.join(import.meta.dir, ".."),
    env: {
      ...process.env,
      PANACODE_PASSWORD: "private-value",
      PANACODE_SERVER_PASSWORD: "previous-value",
      PANACODE_PTY_HANDOFF: "one-use-ticket",
      PANACODE_SERVICE_PROOF_KEY: "per-launch-key",
    },
  })
  expect(await child.exited).toBe(0)
})
