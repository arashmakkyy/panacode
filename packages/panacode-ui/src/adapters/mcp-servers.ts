import { guessBrand } from "../features/mcp-servers/brand-glyphs"
import type { McpServerStatus, McpServerView } from "../features/mcp-servers/types"

/** A server's config entry as the host reads it (only the fields the row may show). */
export type McpConfigLike = { type: "remote"; url: string } | { type: "local"; command: readonly string[] } | { type?: string }

/** A URL without credentials, query or fragment: those can carry secrets. */
export function safeEndpoint(config: McpConfigLike | undefined): string | undefined {
  if (!config) return undefined
  if (config.type === "remote" && "url" in config) {
    try {
      const url = new URL(config.url)
      return `${url.protocol}//${url.host}${url.pathname}`
    } catch {
      return undefined
    }
  }
  if (config.type === "local" && "command" in config) {
    // Only the program and its first argument (the package or script); later arguments can be tokens.
    return config.command.slice(0, 2).join(" ")
  }
  return undefined
}

const STATUS: Record<string, McpServerStatus> = {
  connected: "connected",
  pending: "connecting",
  disabled: "disabled",
  needs_auth: "needs-auth",
  failed: "error",
}

/** Maps the server list, config and resource catalog into the rows of the MCP Servers block. */
export function toMcpServerViews(
  servers: readonly { name: string; title?: string; status: { status: string; error?: string } }[],
  input: {
    config?: (name: string) => McpConfigLike | undefined
    resources?: readonly { server: string; name: string; uri: string; description?: string }[]
    busy?: (name: string) => boolean
  } = {},
): McpServerView[] {
  return servers.map((server) => {
    const config = input.config?.(server.name)
    const endpoint = safeEndpoint(config)
    const busy = input.busy?.(server.name) ?? false
    const status = busy && server.status.status !== "needs_auth" ? "connecting" : (STATUS[server.status.status] ?? "error")
    return {
      id: server.name,
      name: server.title || server.name,
      brand: guessBrand(server.name, endpoint),
      transport: config?.type === "remote" || config?.type === "local" ? config.type : undefined,
      endpoint,
      status,
      error: server.status.error,
      busy,
      resources: (input.resources ?? [])
        .filter((resource) => resource.server === server.name)
        .map((resource) => ({ name: resource.name, uri: resource.uri, description: resource.description })),
    }
  })
}
