import type { McpReportedTool, McpServer, McpTool } from "./types";

/** 610 stays "610"; 1,020 reads "1k" and 2,170 reads "2.2k". */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${Math.round(tokens)}`;
  const thousands = Math.round(tokens / 100) / 10;
  return `${Number.isInteger(thousands) ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
}

/** The same rounding, split into the parts a rolling counter needs. */
export function compactTokens(tokens: number): { value: number; decimals: number; suffix: string } {
  return tokens < 1000 ? { value: Math.round(tokens), decimals: 0, suffix: "" } : { value: Math.round(tokens / 100) / 10, decimals: 1, suffix: "k" };
}

/** Tokens a server adds to context. Servers that are signed out or in error add nothing. */
export function contextTokens(server: McpServer): number {
  if (server.status !== "connected") return 0;
  return server.tools.reduce((sum, tool) => sum + (tool.enabled ? tool.tokens : 0), 0);
}

/** Tools a server loads into context. */
export function toolsOn(server: McpServer): number {
  if (server.status !== "connected") return 0;
  return server.tools.filter(tool => tool.enabled).length;
}

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** The fallback for the authorize screen when a server lists no scopes of its own. */
export function describeScopes(tools: readonly Pick<McpTool, "access">[], name: string): string[] {
  const reads = tools.some(tool => tool.access === "read");
  const writes = tools.some(tool => tool.access === "write");
  return [reads ? `Read data in ${name}` : null, writes ? `Make changes in ${name} when you allow it` : null].filter((line): line is string => line !== null);
}

/** Whether a reported tool starts on: what the server said, else what was known, else reads on and writes off. */
export function startsEnabled(tool: McpReportedTool, known: ReadonlyMap<string, McpReportedTool>): boolean {
  return tool.enabled ?? known.get(tool.id)?.enabled ?? tool.access === "read";
}

/** Drops repeated ids, keeping the first, so a server that reports a tool twice still lists it once. */
export function uniqueTools(tools: readonly McpReportedTool[]): McpReportedTool[] {
  const seen = new Set<string>();
  return tools.filter(tool => {
    if (seen.has(tool.id)) return false;
    seen.add(tool.id);
    return true;
  });
}

/** Turns what discovery reported into the tools a server keeps. */
export function resolveTools(known: readonly McpReportedTool[], reported: readonly McpReportedTool[]): McpTool[] {
  const byId = new Map(known.map(tool => [tool.id, tool]));
  return uniqueTools(reported).map(tool => ({ id: tool.id, name: tool.name, access: tool.access, tokens: tool.tokens, enabled: startsEnabled(tool, byId) }));
}

/** Accepts http and https URLs, with or without the scheme. Anything else is null. */
export function parseServerUrl(input: string): URL | null {
  const value = input.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
    const web = url.protocol === "https:" || url.protocol === "http:";
    const named = url.hostname.includes(".") || url.hostname === "localhost";
    return web && named ? url : null;
  } catch {
    return null;
  }
}

/** A readable name and a stable id for a server added by URL. */
export function describeUrl(url: URL): { id: string; name: string; endpoint: string } {
  const slug = (url.host + url.pathname)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return { id: `url-${slug || "server"}`, name: url.hostname.replace(/^(www|mcp|api)\./, "") || url.hostname, endpoint: url.href };
}
