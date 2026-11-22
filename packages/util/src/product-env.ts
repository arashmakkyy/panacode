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

/** Remove this product's inherited upstream namespace before reading or forwarding the environment. */
export function sanitizeProductEnv(env: NodeJS.ProcessEnv = process.env) {
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith(upstreamPrefix)) delete env[key]
  }
  return env
}
