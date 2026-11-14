/**
 * Panacode product overlay. Keep branding and connect/provider policy here so
 * renames and re-enabling upstream providers stay one-file changes.
 *
 * See `/PANACODE.md` for sync and rollback notes.
 */
export const Product = {
  /** User-facing product name. Swap this to rebrand without hunting string literals. */
  name: "Panacode",
  /** Upstream project this fork tracks. */
  upstream: "OpenCode",
  provider: {
    id: "panaai",
    name: "PanaAI",
    /** Temporary Vercel host; track switching to a custom domain in GitHub issues. */
    baseURL: "https://panaai-psi.vercel.app/v1",
    /**
     * Site origin for browser connect (`/connect/panacode`) and the one-time code exchange.
     * Keep next to `baseURL` so a domain swap is one-file.
     */
    authURL: "https://panaai-psi.vercel.app",
    env: ["PANAAI_API_KEY"] as const,
    package: "@opencode/ai/providers/panaai",
    /** PanaAI settlement does not support streaming yet; force non-stream chat completions. */
    stream: false as const,
  },
  /**
   * When set, `/connect` and the provider catalog only expose these IDs.
   * Set to `undefined` (or empty via override) to restore the full upstream catalog.
   */
  connectAllowlist: ["panaai"] as readonly string[] | undefined,
} as const

export type Product = typeof Product
