import { describe, expect, test } from "bun:test"
import { productEnv, syncProductEnv } from "../src/product-env.js"
import { ProductIdentity } from "../src/product-identity.js"

describe("product-env", () => {
  test("prefers PANACODE_* over OPENCODE_*", () => {
    const previous = {
      PANACODE_FLAGS: process.env.PANACODE_FLAGS,
      OPENCODE_FLAGS: process.env.OPENCODE_FLAGS,
    }
    process.env.OPENCODE_FLAGS = "open"
    process.env.PANACODE_FLAGS = "pana"
    expect(productEnv("FLAGS")).toBe("pana")
    restore(previous)
  })

  test("syncProductEnv copies PANACODE_* onto OPENCODE_*", () => {
    const previous = {
      PANACODE_CONFIG_DIR: process.env.PANACODE_CONFIG_DIR,
      OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
    }
    delete process.env.OPENCODE_CONFIG_DIR
    const env: NodeJS.ProcessEnv = { PANACODE_CONFIG_DIR: "/tmp/panacode-config" }
    syncProductEnv(env)
    expect(env.OPENCODE_CONFIG_DIR).toBe("/tmp/panacode-config")
    restore(previous)
  })

  test("identity isolates from upstream OpenCode", () => {
    expect(ProductIdentity.slug).toBe("panacode")
    expect(ProductIdentity.cli).toBe("panacode")
    expect(ProductIdentity.installDir).toBe(".panacode")
    expect(ProductIdentity.projectDir).toBe(".panacode")
    expect(ProductIdentity.upstreamSlug).toBe("opencode")
    expect(ProductIdentity.configFiles).toEqual(["panacode.json", "panacode.jsonc"])
  })
})

function restore(previous: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
