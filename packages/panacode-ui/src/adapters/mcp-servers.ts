import type { McpServerView } from "../features/mcp-servers"

/** Maps OpenCode MCP server list items into Panacode MCP presentation props. */
export function toMcpServerViews(
  servers: readonly {
    name: string
    status: { status: string; error?: string }
  }[],
): McpServerView[] {
  return servers.map((server) => {
    const status = server.status.status
    return {
      id: server.name,
      name: server.name,
      enabled: status !== "disabled",
      connected: status === "connected",
      error: status === "failed" ? server.status.error ?? "Connection failed" : undefined,
    }
  })
}
