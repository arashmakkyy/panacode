import type { McpConfigLike } from "@panacode/ui/adapters/mcp-servers"
import { safeEndpoint } from "@panacode/ui/adapters/mcp-servers"

import type { ServerSDK } from "@/runtime/server/client"

type Host = Pick<ServerSDK, "url">

const details = new WeakMap<Host, Map<string, McpConfigLike>>()

// Capture the host and location when the operation starts. The user can switch either while awaiting the server.
export function runtimeMcpDetails(host: Host, location: { directory?: string; workspaceID?: string }, name: string) {
  const rows = details.get(host) ?? new Map<string, McpConfigLike>()
  details.set(host, rows)
  const key = JSON.stringify([location.directory, location.workspaceID, name])

  return {
    get: () => rows.get(key),
    add: async (config: McpConfigLike, request: Promise<unknown>) => {
      await request

      if (config.type === "remote") rows.set(key, { type: "remote", url: safeEndpoint(config) ?? "" })

      if (config.type === "local" && "command" in config)
        rows.set(key, { type: "local", command: config.command.slice(0, 2) })
    },
    remove: async (request: Promise<unknown>) => {
      await request
      rows.delete(key)
    },
  }
}
