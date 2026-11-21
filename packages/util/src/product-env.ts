import { ProductIdentity } from "./product-identity.js"

const productPrefix = `${ProductIdentity.envPrefix}_`
const upstreamPrefix = `${ProductIdentity.upstreamEnvPrefix}_`

/**
 * Panacode reads only its own `PANACODE_*` runtime variables.
 *
 * There is deliberately no fallback to `OPENCODE_*`: an ambient OpenCode variable must never
 * move Panacode's database, configuration, service registration, credentials, or child binary.
 * Upstream values are stripped at the application boundary instead of translated.
 */
export function productEnvName(suffix: string) {
  return `${productPrefix}${suffix}`
}

export function productEnv(suffix: string): string | undefined {
  return process.env[productEnvName(suffix)]
}

export function isProductEnv(name: string) {
  return name.toUpperCase().startsWith(productPrefix)
}

export function upstreamEnvName(suffix: string) {
  return `${upstreamPrefix}${suffix}`
}

/**
 * Upstream runtime variables that must not reach Panacode's process tree.
 *
 * Compile-time build constants such as `OPENCODE_CHANNEL` and `OPENCODE_VERSION` are not
 * environment variables and are intentionally absent here.
 */
const upstreamRuntimeKeys = new Set([
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
])

/** Remove inherited upstream runtime overrides before Panacode reads or forwards its environment. */
export function sanitizeProductEnv(env: NodeJS.ProcessEnv = process.env) {
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase()
    if (!upper.startsWith(upstreamPrefix)) continue
    if (upstreamRuntimeKeys.has(upper.slice(upstreamPrefix.length))) delete env[key]
  }
  return env
}
