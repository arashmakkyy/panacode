import type { ReactNode } from "react";
import type { McpBrand } from "./brand-glyphs";

export type { McpBrand };

/** Remote servers are reached over HTTP. Local servers run as a process or on a loopback address. */
export type McpTransport = "remote" | "local";

/** Only "connected" servers count toward context. */
export type McpStatus = "connected" | "needs-auth" | "error";

/** What happens before a tool runs: ask every time, or let read tools run without asking. */
export type McpPermission = "ask" | "allow-reads";

/** Read tools only fetch. Write tools change something. */
export type McpAccess = "read" | "write";

/** One tool a server reports. */
export interface McpTool {
  /** Stable id, usually the tool name. */
  id: string;
  /** The name the model sees, for example create_issue. Shown in the mono face. */
  name: string;
  /** Shown as an icon and a word, and used by Always allow reads. */
  access: McpAccess;
  /** Tokens the tool's name, description and input schema take in context. */
  tokens: number;
  /** Whether the tool is loaded into the agent's context. */
  enabled: boolean;
}

/** A tool as discovery reports it. `enabled` is optional: reads default on, writes off. */
export type McpReportedTool = Omit<McpTool, "enabled"> & { enabled?: boolean };

/** One of the agent's servers. */
export interface McpServer {
  id: string;
  name: string;
  /** Picks the real mark. Leave unset for the generic MCP mark. */
  brand?: McpBrand;
  transport: McpTransport;
  /** The URL or command the server is reached at. */
  endpoint?: string;
  status: McpStatus;
  /** A short reason, shown when status is "error". */
  error?: string;
  /** Defaults to "ask". */
  permission?: McpPermission;
  /** What signing in grants, listed on the authorize screen. Derived from the tools when unset. */
  scopes?: string[];
  tools: McpTool[];
}

/** A server that Add server offers. */
export interface McpDirectoryEntry {
  id: string;
  name: string;
  brand?: McpBrand;
  /** One line. */
  description: string;
  transport: McpTransport;
  endpoint?: string;
  /** OAuth entries show the authorize step first. */
  auth: "oauth" | "none";
  scopes?: string[];
  tools: McpReportedTool[];
}

/** Passed to onConnect when a server connects. */
export interface McpConnectRequest {
  /** "directory" and "url" add a server, "reconnect" signs in again, "retry" retries a server in error. */
  kind: "directory" | "url" | "reconnect" | "retry";
  serverId: string;
  name: string;
  transport: McpTransport;
  endpoint?: string;
}

/** The signed in person shown on the authorize screen. */
export interface McpAccount {
  name: string;
  email: string;
  avatar?: string;
}

export interface McpServersProps {
  /**
   * The agent's servers. Only enabled tools of connected servers count toward context. Leave unset for the simulated
   * demo; passing a new array replaces the list.
   */
  servers?: McpServer[];
  /** What Add server offers. Entries whose id is already in the list read Added. */
  directory?: McpDirectoryEntry[];
  /**
   * Tokens of context you are willing to spend on tool definitions. The bar spans the budget; past it the bar
   * rescales, the overflow turns amber and the label says how far over it is.
   */
  budget?: number;
  /** Heading of the card. */
  title?: string;
  /** Your agent's name on the authorize screen. */
  clientName?: string;
  /** Your agent's mark on the authorize screen, drawn in a 28px box. */
  clientMark?: ReactNode;
  /** The signed in person shown on the authorize screen. */
  account?: McpAccount;
  /** Called when a tool is switched on or off in a server's list. */
  onToggleTool?: (serverId: string, toolId: string, enabled: boolean) => void;
  /**
   * Called when a server connects. For OAuth servers it runs when Authorize is pressed, so open your consent window
   * here. Resolve with the tools the server reported, or with nothing to use the tools already known for it. A
   * rejection shows the error with Try again, using the error's message. Without it, the whole flow is simulated.
   */
  onConnect?: (request: McpConnectRequest) => void | McpReportedTool[] | Promise<void | McpReportedTool[]>;
  /**
   * Called once a removal's undo window closes (about 6 seconds, paused while the pointer or focus rests on the
   * bar), or when another remove starts.
   */
  onRemove?: (serverId: string) => void;
  /** Called when a server's default for tool calls changes. */
  onPermissionChange?: (serverId: string, permission: McpPermission) => void;
  /** Class on the root element. */
  className?: string;
}
