/**
 * Panacode product path/CLI identity.
 *
 * Keep this in util so Global and other low-level path helpers can isolate
 * user data from upstream OpenCode without depending on Core.
 * Mirror display branding in `packages/core/src/panacode/product.ts`.
 */
export const ProductIdentity = {
  /** XDG app name and project-local directory (`.panacode`). */
  slug: "panacode",
  /** Primary CLI / binary command name. */
  cli: "panacode",
  /** Env var prefix; prefer these over the upstream OpenCode equivalents. */
  envPrefix: "PANACODE",
  /** Upstream OpenCode slug kept for docs and env fallback. */
  upstreamSlug: "opencode",
  /** Upstream OpenCode env prefix. */
  upstreamEnvPrefix: "OPENCODE",
  /** Curl-installer directory under `$HOME` (`~/.panacode/bin`). */
  installDir: ".panacode",
  /** Project-local config directory name. */
  projectDir: ".panacode",
  /** Config file basenames discovered next to a project. */
  configFiles: ["panacode.json", "panacode.jsonc"] as const,
  /** Default config file written when none exists yet. */
  defaultConfigFile: "panacode.jsonc",
} as const

export type ProductIdentity = typeof ProductIdentity
