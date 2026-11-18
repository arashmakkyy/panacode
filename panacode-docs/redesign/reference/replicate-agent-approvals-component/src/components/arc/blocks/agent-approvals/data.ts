import type { BrandId } from "./marks";

export type Risk = "low" | "medium" | "high";
export type Provider = "anthropic" | "openai" | "google" | (string & {});

export interface ApprovalAgent {
  id: string;
  name: string;
  model: string;
  provider?: Provider;
}

export interface ApprovalTool {
  /** The permission rules match on, for example "vercel.deploy". */
  id: string;
  name: string;
  /** Names the permission in the rules list, for example "Deploy to production". */
  action: string;
  brand?: BrandId;
}

export interface ApprovalArgument {
  key: string;
  label: string;
  value: string;
  /** Defaults to true. */
  editable?: boolean;
  mono?: boolean;
  multiline?: boolean;
}

export interface ApprovalRequest {
  id: string;
  agent: ApprovalAgent;
  tool: ApprovalTool;
  /** The call in plain words. Wrap code in backticks to set it in the mono face. */
  title: string;
  summary: string;
  reason: string;
  args: ApprovalArgument[];
  risk: Risk;
  /** ISO timestamp. */
  requestedAt: string;
}

export interface ApprovalRule {
  id: string;
  tool: ApprovalTool;
  scope: "agent" | "workspace";
  agent?: { id: string; name: string };
  createdBy?: string;
  createdAt?: string;
}

export type ResolvedOutcome = "approved" | "denied" | "allowed";

export interface ResolvedEntry {
  id: string;
  agentName: string;
  tool: ApprovalTool;
  summary: string;
  outcome: ResolvedOutcome;
  edited?: boolean;
  decidedBy: string;
  decidedAt: string;
}

export interface ApprovalDecision {
  requestId: string;
  outcome: ResolvedOutcome;
  args: Record<string, string>;
  edited: boolean;
  ruleId?: string;
  decidedBy: string;
  decidedAt: string;
}

export interface RuleChange {
  type: "added" | "removed";
  rule: ApprovalRule;
}

/* ───────────────────────── Sample data (plays with no props) ───────────────────────── */

const at = (time: string) => `2026-10-20T${time}:00`;

/** The demo clock starts here so "2 min ago" reads naturally. */
export const DEMO_NOW = "2026-10-20T14:32:00";

const deployAgent: ApprovalAgent = { id: "deploy", name: "Deploy agent", model: "Claude Opus 5.5", provider: "anthropic" };
const supportAgent: ApprovalAgent = { id: "support", name: "Support agent", model: "GPT-6 Luna", provider: "openai" };
const dataAgent: ApprovalAgent = { id: "data", name: "Data agent", model: "Gemini 4 Argon", provider: "google" };
const triageAgent: ApprovalAgent = { id: "triage", name: "Triage agent", model: "Claude Haiku 5.5", provider: "anthropic" };

const vercelDeploy: ApprovalTool = { id: "vercel.deploy", name: "Vercel", action: "Deploy to production", brand: "vercel" };
const gmailSend: ApprovalTool = { id: "gmail.send", name: "Gmail", action: "Send email", brand: "gmail" };
const postgresWrite: ApprovalTool = { id: "postgres.write", name: "PostgreSQL", action: "Write to billing-prod", brand: "postgresql" };
const githubPr: ApprovalTool = { id: "github.pr", name: "GitHub", action: "Open pull requests", brand: "github" };
const sentryRead: ApprovalTool = { id: "sentry.read", name: "Sentry", action: "Read issues", brand: "sentry" };

export const SAMPLE_REQUESTS: ApprovalRequest[] = [
  {
    id: "req-deploy-web",
    agent: deployAgent,
    tool: vercelDeploy,
    title: "Run `vercel deploy --prod`",
    summary: "Deploy northwind-web to production",
    reason: "The preview passed all 214 checks and the release window opened at 14:00.",
    args: [
      { key: "project", label: "Project", value: "northwind-web", mono: true },
      { key: "commit", label: "Commit", value: "8f3c2a1 Ship pricing v3", mono: true, editable: false },
      { key: "target", label: "Target", value: "production", mono: true },
      { key: "regions", label: "Regions", value: "fra1, iad1", mono: true },
    ],
    risk: "high",
    requestedAt: at("14:30"),
  },
  {
    id: "req-email-dana",
    agent: supportAgent,
    tool: gmailSend,
    title: "Send an email with Gmail",
    summary: "Email dana@halcyon.studio about her refund",
    reason: "Dana asked for an update twice today, and the refund cleared in Stripe at 13:52.",
    args: [
      { key: "to", label: "To", value: "dana@halcyon.studio" },
      { key: "subject", label: "Subject", value: "Your refund for order #48213" },
      {
        key: "body",
        label: "Body",
        value: "Hi Dana, I have refunded $129.00 to your Visa ending 4242. It usually arrives in 5 to 10 business days.",
        multiline: true,
      },
    ],
    risk: "medium",
    requestedAt: at("14:27"),
  },
  {
    id: "req-sql-plans",
    agent: dataAgent,
    tool: postgresWrite,
    title: "`UPDATE` 1,284 rows in PostgreSQL",
    summary: "Move 1,284 legacy plans to team",
    reason: "Moves legacy team plans to the new plan before the 02:00 billing run.",
    args: [
      { key: "database", label: "Database", value: "billing-prod", mono: true, editable: false },
      {
        key: "statement",
        label: "Statement",
        value: "UPDATE subscriptions SET plan = 'team' WHERE plan = 'team_legacy';",
        mono: true,
        multiline: true,
      },
      { key: "rows", label: "Rows", value: "1,284", editable: false },
    ],
    risk: "high",
    requestedAt: at("14:21"),
  },
  {
    id: "req-deploy-docs",
    agent: deployAgent,
    tool: vercelDeploy,
    title: "Run `vercel deploy --prod`",
    summary: "Deploy northwind-docs to production",
    reason: "The pricing v3 docs are reviewed and should ship with the web release.",
    args: [
      { key: "project", label: "Project", value: "northwind-docs", mono: true },
      { key: "commit", label: "Commit", value: "c41d9e7 Update pricing pages", mono: true, editable: false },
      { key: "target", label: "Target", value: "production", mono: true },
      { key: "regions", label: "Regions", value: "fra1", mono: true },
    ],
    risk: "medium",
    requestedAt: at("14:19"),
  },
  {
    id: "req-close-web",
    agent: triageAgent,
    tool: { id: "linear.close", name: "Linear", action: "Close issues", brand: "linear" },
    title: "Close 6 issues in Linear",
    summary: "Close 6 duplicates of WEB-398",
    reason: "All six report the Safari checkout bug that WEB-398 fixed in v2.14.",
    args: [
      { key: "issues", label: "Issues", value: "WEB-412, WEB-418, WEB-421, WEB-427, WEB-433, WEB-440", mono: true },
      { key: "state", label: "Close as", value: "Duplicate of WEB-398" },
      { key: "comment", label: "Comment", value: "Fixed by WEB-398, shipped in v2.14." },
    ],
    risk: "low",
    requestedAt: at("14:16"),
  },
];

export const SAMPLE_RULES: ApprovalRule[] = [
  {
    id: "rule-github-pr",
    tool: githubPr,
    scope: "agent",
    agent: { id: deployAgent.id, name: deployAgent.name },
    createdBy: "Marcus Johnson",
    createdAt: at("09:12"),
  },
  { id: "rule-sentry-read", tool: sentryRead, scope: "workspace", createdBy: "Emma Collins", createdAt: at("10:40") },
];

export const SAMPLE_RESOLVED: ResolvedEntry[] = [
  {
    id: "log-refund",
    agentName: supportAgent.name,
    tool: { id: "stripe.refund", name: "Stripe", action: "Issue refunds", brand: "stripe" },
    summary: "Refund $129.00 on order #48213",
    outcome: "approved",
    decidedBy: "Emma Collins",
    decidedAt: at("13:52"),
  },
  {
    id: "log-events",
    agentName: dataAgent.name,
    tool: postgresWrite,
    summary: "Delete events older than January 2025",
    outcome: "denied",
    decidedBy: "Marcus Johnson",
    decidedAt: at("13:41"),
  },
  {
    id: "log-sentry",
    agentName: triageAgent.name,
    tool: sentryRead,
    summary: "Read 14 issues in northwind-web",
    outcome: "allowed",
    decidedBy: "Rule",
    decidedAt: at("13:30"),
  },
  {
    id: "log-pr",
    agentName: deployAgent.name,
    tool: githubPr,
    summary: "Open pull request #2143",
    outcome: "allowed",
    decidedBy: "Rule",
    decidedAt: at("12:58"),
  },
  {
    id: "log-api",
    agentName: deployAgent.name,
    tool: vercelDeploy,
    summary: "Deploy northwind-api to production",
    outcome: "approved",
    edited: true,
    decidedBy: "Emma Collins",
    decidedAt: at("11:20"),
  },
  {
    id: "log-invoice",
    agentName: supportAgent.name,
    tool: gmailSend,
    summary: "Email leo@brightpath.io about invoice 1042",
    outcome: "denied",
    decidedBy: "Emma Collins",
    decidedAt: at("10:05"),
  },
];
