import { ProductIdentity } from "./product-identity.js"

const productPrefix = `${ProductIdentity.envPrefix}_`
const upstreamPrefix = `${ProductIdentity.upstreamEnvPrefix}_`

/**
 * Prefer `PANACODE_*` over `OPENCODE_*` for the same suffix.
 * Call early (or import this module for the side-effect sync) so existing
 * `process.env.OPENCODE_*` readers pick up Panacode overrides.
 */
export function productEnv(suffix: string): string | undefined {
  return process.env[`${ProductIdentity.envPrefix}_${suffix}`] ?? process.env[`${ProductIdentity.upstreamEnvPrefix}_${suffix}`]
}

/** Copy every set `PANACODE_*` onto the matching `OPENCODE_*` key (Panacode wins). */
export function syncProductEnv(env: NodeJS.ProcessEnv = process.env) {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(productPrefix) || value === undefined) continue
    env[`${upstreamPrefix}${key.slice(productPrefix.length)}`] = value
  }
  return env
}

syncProductEnv()
