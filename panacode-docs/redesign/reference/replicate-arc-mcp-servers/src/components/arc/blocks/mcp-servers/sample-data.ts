import type { McpAccess, McpAccount, McpDirectoryEntry, McpReportedTool, McpServer, McpTool } from "./types";

/*
 * Sample values for the demo: the endpoints, token counts and directory are illustrative. Replace them with your
 * agent's servers and measure tokens per tool with your provider's token counter.
 */

const tool = (id: string, access: McpAccess, tokens: number, enabled = access === "read"): McpTool => ({ id, name: id, access, tokens, enabled });
const offer = (id: string, access: McpAccess, tokens: number): McpReportedTool => ({ id, name: id, access, tokens });

export const sampleServers: McpServer[] = [
  {
    id: "github",
    name: "GitHub",
    brand: "github",
    transport: "remote",
    endpoint: "https://api.githubcopilot.com/mcp/",
    status: "connected",
    permission: "allow-reads",
    tools: [
      tool("search_code", "read", 420),
      tool("get_pull_request", "read", 290),
      tool("list_issues", "read", 400),
      tool("create_issue", "write", 420, true),
      tool("create_pull_request", "write", 640, true),
      tool("merge_pull_request", "write", 360, false),
    ],
  },
  {
    id: "linear",
    name: "Linear",
    brand: "linear",
    transport: "remote",
    endpoint: "https://mcp.linear.app/mcp",
    status: "connected",
    permission: "allow-reads",
    tools: [
      tool("list_issues", "read", 310),
      tool("get_issue", "read", 260),
      tool("create_issue", "write", 450, true),
      tool("update_issue", "write", 480, false),
      tool("list_projects", "read", 260, false),
    ],
  },
  {
    id: "notion",
    name: "Notion",
    brand: "notion",
    transport: "remote",
    endpoint: "https://mcp.notion.com/mcp",
    status: "needs-auth",
    permission: "ask",
    scopes: ["Search and read pages you share with it", "Create pages and add comments"],
    tools: [tool("search", "read", 380), tool("fetch", "read", 300), tool("create_pages", "write", 520, false), tool("update_page", "write", 460, false)],
  },
  {
    id: "slack",
    name: "Slack",
    brand: "slack",
    transport: "remote",
    endpoint: "https://mcp.slack.com/mcp",
    status: "connected",
    permission: "ask",
    tools: [tool("search_messages", "read", 360), tool("get_thread", "read", 280, false), tool("list_channels", "read", 240), tool("post_message", "write", 420, true)],
  },
  {
    id: "sentry",
    name: "Sentry",
    brand: "sentry",
    transport: "remote",
    endpoint: "https://mcp.sentry.dev/mcp",
    status: "error",
    permission: "allow-reads",
    error: "tools/list timed out after 30 seconds",
    tools: [tool("search_issues", "read", 330), tool("get_issue_details", "read", 410), tool("update_issue_status", "write", 300, false)],
  },
  {
    id: "stripe",
    name: "Stripe",
    brand: "stripe",
    transport: "remote",
    endpoint: "https://mcp.stripe.com",
    status: "connected",
    permission: "ask",
    tools: [tool("list_customers", "read", 320), tool("list_invoices", "read", 290), tool("create_refund", "write", 350, false), tool("create_payment_link", "write", 420, false)],
  },
  {
    id: "postgresql",
    name: "PostgreSQL",
    brand: "postgresql",
    transport: "local",
    endpoint: "npx @northwind/mcp-postgres postgres://localhost/analytics",
    status: "connected",
    permission: "allow-reads",
    tools: [tool("query", "read", 290), tool("list_tables", "read", 180), tool("describe_table", "read", 260)],
  },
  {
    id: "figma",
    name: "Figma",
    brand: "figma",
    transport: "local",
    endpoint: "http://127.0.0.1:3845/mcp",
    status: "connected",
    permission: "allow-reads",
    tools: [tool("get_design_context", "read", 610), tool("get_screenshot", "read", 240), tool("get_variable_defs", "read", 300, false)],
  },
];

export const sampleDirectory: McpDirectoryEntry[] = [
  {
    id: "vercel",
    name: "Vercel",
    brand: "vercel",
    description: "Deployments, build logs and project settings",
    transport: "remote",
    endpoint: "https://mcp.vercel.com",
    auth: "oauth",
    scopes: ["Read projects, deployments and build logs", "Create preview deployments"],
    tools: [offer("list_projects", "read", 240), offer("list_deployments", "read", 310), offer("get_build_logs", "read", 380), offer("create_deployment", "write", 460), offer("promote_deployment", "write", 330)],
  },
  {
    id: "supabase",
    name: "Supabase",
    brand: "supabase",
    description: "Tables, SQL and edge functions",
    transport: "remote",
    endpoint: "https://mcp.supabase.com/mcp",
    auth: "oauth",
    scopes: ["Read tables and run read only SQL", "Apply migrations and deploy functions"],
    tools: [offer("list_tables", "read", 220), offer("execute_sql", "read", 360), offer("apply_migration", "write", 420), offer("deploy_edge_function", "write", 480)],
  },
  {
    id: "datadog",
    name: "Datadog",
    brand: "datadog",
    description: "Metrics, monitors and logs",
    transport: "remote",
    endpoint: "https://mcp.datadoghq.com/mcp",
    auth: "oauth",
    scopes: ["Read metrics, monitors and logs", "Mute and unmute monitors"],
    tools: [offer("query_metrics", "read", 420), offer("search_logs", "read", 390), offer("list_monitors", "read", 260), offer("mute_monitor", "write", 280)],
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    brand: "cloudflare",
    description: "Workers, KV namespaces and DNS records",
    transport: "remote",
    endpoint: "https://bindings.mcp.cloudflare.com/mcp",
    auth: "oauth",
    scopes: ["Read Workers, KV and DNS", "Edit DNS records"],
    tools: [offer("workers_list", "read", 230), offer("kv_get", "read", 210), offer("dns_records_list", "read", 280), offer("dns_record_update", "write", 390)],
  },
  {
    id: "googledrive",
    name: "Google Drive",
    brand: "googledrive",
    description: "Search and read files in shared drives",
    transport: "remote",
    endpoint: "https://drivemcp.googleapis.com/mcp",
    auth: "oauth",
    scopes: ["See and download files in your Drive"],
    tools: [offer("search_files", "read", 340), offer("read_file", "read", 260)],
  },
  {
    id: "atlassian",
    name: "Atlassian",
    brand: "atlassian",
    description: "Jira issues and Confluence pages",
    transport: "remote",
    endpoint: "https://mcp.atlassian.com/v1/sse",
    auth: "oauth",
    scopes: ["Read Jira issues and Confluence pages", "Create and edit issues"],
    tools: [offer("search_jira", "read", 380), offer("get_confluence_page", "read", 290), offer("create_jira_issue", "write", 470), offer("add_comment", "write", 260)],
  },
  {
    id: "hubspot",
    name: "HubSpot",
    brand: "hubspot",
    description: "Contacts, companies and deals",
    transport: "remote",
    endpoint: "https://mcp.hubspot.com",
    auth: "oauth",
    scopes: ["Read contacts, companies and deals", "Add notes to records"],
    tools: [offer("search_contacts", "read", 330), offer("get_deal", "read", 270), offer("create_note", "write", 300)],
  },
  {
    id: "posthog",
    name: "PostHog",
    brand: "posthog",
    description: "Product analytics, insights and feature flags",
    transport: "remote",
    endpoint: "https://mcp.posthog.com/mcp",
    auth: "oauth",
    scopes: ["Read insights and feature flags", "Update feature flag rollouts"],
    tools: [offer("query_insight", "read", 410), offer("list_feature_flags", "read", 230), offer("update_feature_flag", "write", 360)],
  },
  {
    id: "asana",
    name: "Asana",
    brand: "asana",
    description: "Tasks, projects and comments",
    transport: "remote",
    endpoint: "https://mcp.asana.com/sse",
    auth: "oauth",
    scopes: ["Read tasks and projects", "Create tasks and comments"],
    tools: [offer("search_tasks", "read", 300), offer("get_project", "read", 240), offer("create_task", "write", 380)],
  },
  {
    id: "airtable",
    name: "Airtable",
    brand: "airtable",
    description: "Bases, tables and records",
    transport: "remote",
    endpoint: "https://mcp.airtable.com/mcp",
    auth: "oauth",
    scopes: ["Read bases and records", "Create and update records"],
    tools: [offer("list_bases", "read", 200), offer("search_records", "read", 310), offer("update_records", "write", 400)],
  },
  {
    id: "docker",
    name: "Docker",
    brand: "docker",
    description: "Containers and images on this machine",
    transport: "local",
    endpoint: "docker mcp gateway run",
    auth: "none",
    tools: [offer("list_containers", "read", 210), offer("container_logs", "read", 260), offer("restart_container", "write", 240)],
  },
];

/** What a server added by URL is assumed to offer until discovery reports its real tools. */
export const urlServerTools: McpReportedTool[] = [offer("search", "read", 280), offer("fetch", "read", 240)];

/** In the demo, the first discovery on these ids fails once so the error state can be seen. */
export const simulatedFailures: ReadonlySet<string> = new Set(["datadog"]);

/** A soft gradient stand-in for a profile photo, so the sample account needs no image file. */
const sampleAvatar = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><radialGradient id="a" cx="44%" cy="42%" r="52%"><stop stop-color="#7a40ef" stop-opacity=".8"/><stop offset=".5" stop-color="#7a40ef" stop-opacity=".55"/><stop offset="1" stop-color="#7a40ef" stop-opacity="0"/></radialGradient><radialGradient id="b" cx="86%" cy="14%" r="50%"><stop stop-color="#66fb98" stop-opacity=".6"/><stop offset="1" stop-color="#66fb98" stop-opacity="0"/></radialGradient><radialGradient id="c" cx="90%" cy="72%" r="34%"><stop stop-color="#66fb98" stop-opacity=".7"/><stop offset="1" stop-color="#66fb98" stop-opacity="0"/></radialGradient><radialGradient id="d" cx="50%" cy="46%" r="36%"><stop stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="100" height="100" fill="#ee6019"/><rect width="100" height="100" fill="url(#a)"/><rect width="100" height="100" fill="url(#b)"/><rect width="100" height="100" fill="url(#c)"/><rect width="100" height="100" fill="url(#d)"/></svg>',
)}`;

export const sampleAccount: McpAccount = { name: "Emma Collins", email: "emma@northwind.dev", avatar: sampleAvatar };
