import type { McpBrand } from "./brand-glyphs"

export type { McpBrand }

/** "connecting" covers a pending server and a toggle in flight. Only "connected" servers give the agent tools. */
export type McpServerStatus = "connected" | "connecting" | "disabled" | "needs-auth" | "error"

/** Remote servers are reached over HTTP; local servers run as a process. */
export type McpTransport = "remote" | "local"

export interface McpResourceView {
  name: string
  uri: string
  description?: string
}

export interface McpServerView {
  id: string
  name: string
  brand?: McpBrand
  transport?: McpTransport
  /** URL (without query or credentials) or the command's first words. */
  endpoint?: string
  status: McpServerStatus
  error?: string
  /** A connect, disconnect or sign-in for this server is running. */
  busy?: boolean
  resources: McpResourceView[]
}

export type McpAddRequest =
  | { name: string; transport: "remote"; url: string }
  | { name: string; transport: "local"; command: string[] }

export interface McpServersLabels {
  title: string
  add: string
  summary: (connected: number, total: number) => string
  resources: (count: number) => string
  status: Record<McpServerStatus, string>
  transport: Record<McpTransport, string>
  signIn: string
  retry: string
  remove: string
  removed: (name: string) => string
  filterTitle: string
  filters: Record<"all" | "connected" | "other", string>
  noMatches: string
  removedCount: (count: number) => string
  restored: (count: number) => string
  undo: string
  toggle: (name: string) => string
  details: (name: string) => string
  noResources: string
  resourcesHeading: string
  emptyTitle: string
  emptyBody: string
  sheetTitle: string
  close: string
  name: string
  namePlaceholder: string
  url: string
  urlPlaceholder: string
  command: string
  commandPlaceholder: string
  connect: string
  connecting: string
  nameTaken: string
  invalidUrl: string
  invalidCommand: string
  invalidName: string
  sheetNote: string
}

export const defaultMcpServersLabels: McpServersLabels = {
  title: "MCP servers",
  add: "Add server",
  summary: (connected, total) => `${connected} of ${total} connected`,
  resources: (count) => (count === 1 ? "1 resource" : `${count} resources`),
  status: { connected: "Connected", connecting: "Connecting", disabled: "Off", "needs-auth": "Needs sign in", error: "Error" },
  transport: { remote: "Remote", local: "Local" },
  signIn: "Sign in",
  retry: "Retry",
  remove: "Remove",
  removed: (name) => `Removed ${name}`,
  filterTitle: "Filter connections",
  filters: { all: "All", connected: "Connected", other: "Other" },
  noMatches: "No matching connections",
  removedCount: (count) => `Removed ${count} servers`,
  restored: (count) => `Restored ${count} ${count === 1 ? "server" : "servers"}`,
  undo: "Undo",
  toggle: (name) => `Turn ${name} on or off`,
  details: (name) => `${name} details`,
  noResources: "This server shares no resources.",
  resourcesHeading: "Resources",
  emptyTitle: "No servers yet",
  emptyBody: "Add a server to give the agent its tools. A remote server is a URL; a local one is a command that runs on this computer.",
  sheetTitle: "Add a server",
  close: "Close",
  name: "Name",
  namePlaceholder: "github",
  url: "Server URL",
  urlPlaceholder: "https://mcp.example.com/mcp",
  command: "Command",
  commandPlaceholder: "npx -y @modelcontextprotocol/server-filesystem .",
  connect: "Add and connect",
  connecting: "Adding",
  nameTaken: "A server with this name already exists.",
  invalidUrl: "Enter a full http or https URL.",
  invalidCommand: "Enter the command that starts the server.",
  invalidName: "Use letters, numbers, dashes or underscores.",
  sheetNote: "Added servers are not saved; they last while this workspace stays open. To keep one, add it to your config file.",
}
