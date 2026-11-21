import { describe, expect, test } from "bun:test"
import { productEnv, sanitizeProductEnv } from "../src/product-env.js"
import { ProductIdentity } from "../src/product-identity.js"

describe("product-env", () => {
  test("reads PANACODE_* and ignores an ambient OPENCODE_* value", () => {
    const previous = {
      PANACODE_FLAGS: process.env.PANACODE_FLAGS,
      OPENCODE_FLAGS: process.env.OPENCODE_FLAGS,
    }
    process.env.OPENCODE_FLAGS = "open"
    process.env.PANACODE_FLAGS = "pana"
    expect(productEnv("FLAGS")).toBe("pana")
    delete process.env.PANACODE_FLAGS
    expect(productEnv("FLAGS")).toBeUndefined()
    restore(previous)
  })

  test("sanitizeProductEnv removes upstream runtime overrides without touching unrelated settings", () => {
    const env: NodeJS.ProcessEnv = {
      OPENCODE_DB: "/tmp/opencode.db",
      OPENCODE_PASSWORD: "secret",
      OPENCODE_CONFIG_DIR: "/tmp/opencode",
      // Provider credentials belong to the provider's own auth store; an ambient OpenCode key must not
      // activate a provider inside Panacode.
      OPENCODE_API_KEY: "opencode-key",
      PANACODE_DB: "/tmp/panacode.db",
      HTTPS_PROXY: "http://proxy.invalid",
      PANAAI_API_KEY: "pana",
      OPENCODE_CHANNEL: "prod",
    }
    sanitizeProductEnv(env)
    expect(env.OPENCODE_DB).toBeUndefined()
    expect(env.OPENCODE_PASSWORD).toBeUndefined()
    expect(env.OPENCODE_CONFIG_DIR).toBeUndefined()
    expect(env.OPENCODE_API_KEY).toBeUndefined()
    expect(env.PANACODE_DB).toBe("/tmp/panacode.db")
    expect(env.HTTPS_PROXY).toBe("http://proxy.invalid")
    expect(env.PANAAI_API_KEY).toBe("pana")
    // An inherited channel belongs to another product's runtime, not to Panacode.
    expect(env.OPENCODE_CHANNEL).toBeUndefined()
  })

  test("sanitizeProductEnv strips the complete upstream runtime override set and keeps Panacode names", () => {
    // Keep this list in sync with the runtime variables OpenCode accepts. It is a boundary
    // contract: an ambient value for any of these must not reach Panacode's process tree.
    const suffixes = [
      "API_KEY",
      "ARTIFACT",
      "CHANNEL",
      "CLIENT",
      "CONFIG",
      "CONFIG_CONTENT",
      "CONFIG_DIR",
      "CONFIG_PROJECT_DISABLE",
      "DB",
      "DISABLE_AUTOUPDATE",
      "DISABLE_CHANNEL_DB",
      "DISABLE_CLAUDE_CODE",
      "DISABLE_CLAUDE_CODE_SKILLS",
      "DISABLE_EMBEDDED_WEB_UI",
      "DISABLE_FFF",
      "DISABLE_FILEWATCHER",
      "DISABLE_FREE_MODELS",
      "DISABLE_MODELS_FETCH",
      "DISABLE_PROJECT_CONFIG",
      "EXPERIMENTAL_FILEWATCHER",
      "EXPERIMENTAL_ICON_DISCOVERY",
      "FILEWATCHER_DISABLE",
      "FLAGS",
      "GIT_BASH_PATH",
      "MODELS_PATH",
      "MODELS_URL",
      "PASSWORD",
      "PTY_BIN",
      "PTY_HANDOFF",
      "SERVER_PASSWORD",
      "SIMULATE",
      "SSH_ASKPASS_PORT",
      "SSH_ASKPASS_TOKEN",
      "TEST_HOME",
      "TUI_CHANNEL",
      "VERSION",
    ] as const
    const env: NodeJS.ProcessEnv = {
      HTTPS_PROXY: "http://proxy.invalid",
      PANAAI_API_KEY: "pana",
      // Unknown upstream variables are not rewritten here; the CLI session filter drops every
      // OPENCODE_* value before a child starts.
      OPENCODE_SESSION_ONLY: "kept-for-the-cli-filter",
    }
    for (const suffix of suffixes) {
      env[`OPENCODE_${suffix}`] = `upstream-${suffix}`
      env[`PANACODE_${suffix}`] = `product-${suffix}`
      env[`opencode_${suffix.toLowerCase()}`] = `upstream-lower-${suffix}`
    }

    sanitizeProductEnv(env)

    for (const suffix of suffixes) {
      expect(env[`OPENCODE_${suffix}`], suffix).toBeUndefined()
      expect(env[`opencode_${suffix.toLowerCase()}`], suffix).toBeUndefined()
      expect(env[`PANACODE_${suffix}`], suffix).toBe(`product-${suffix}`)
    }
    expect(env.OPENCODE_SESSION_ONLY).toBe("kept-for-the-cli-filter")
    expect(env.HTTPS_PROXY).toBe("http://proxy.invalid")
    expect(env.PANAAI_API_KEY).toBe("pana")
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
