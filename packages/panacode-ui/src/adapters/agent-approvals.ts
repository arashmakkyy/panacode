import type { ApprovalArgument, ApprovalDecision, ApprovalRequest, ApprovalRisk } from "../features/agent-approvals"
import type { ApprovalIconName } from "../features/agent-approvals/icons"

/** The fields of an OpenCode `PermissionRequest` the approvals card reads (kept structural, no client import). */
export type PermissionLike = {
  id: string
  action: string
  resources: readonly string[]
  save?: readonly string[]
  message?: string
  metadata?: { [key: string]: unknown }
}

export type PermissionKind = "shell" | "edit" | "read" | "web" | "directory" | "tool"

export type PermissionCopy = {
  /** Title templates per kind, `{{target}}` is replaced with the backticked target. */
  title: Record<PermissionKind | "create", string>
  /** Display name for the asking tool, e.g. "Bash". Falls back to the raw action. */
  tool: (action: string) => string | undefined
  command: string
  path: string
  url: string
  resource: string
  pattern: string
  changes: string
}

const KIND: Record<string, PermissionKind> = {
  bash: "shell",
  shell: "shell",
  edit: "edit",
  write: "edit",
  patch: "edit",
  apply_patch: "edit",
  read: "read",
  glob: "read",
  grep: "read",
  list: "read",
  lsp: "read",
  webfetch: "web",
  websearch: "web",
  external_directory: "directory",
}

const RISK: Record<PermissionKind, ApprovalRisk> = {
  shell: "high",
  directory: "high",
  edit: "medium",
  tool: "medium",
  web: "low",
  read: "low",
}

const ICON: Record<PermissionKind, ApprovalIconName> = {
  shell: "terminal",
  edit: "edit",
  read: "search",
  web: "globe",
  directory: "folder",
  tool: "wrench",
}

export const permissionKind = (action: string): PermissionKind => KIND[action] ?? "tool"
export const permissionRisk = (action: string): ApprovalRisk => RISK[permissionKind(action)]

const clip = (value: string, max = 72) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)
const base = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path
const str = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value))

type FilePreview = { file?: unknown; additions?: unknown; deletions?: unknown; status?: unknown; patch?: unknown }
const files = (metadata: PermissionLike["metadata"]): FilePreview[] =>
  Array.isArray(metadata?.files) ? (metadata.files as unknown[]).filter((f): f is FilePreview => !!f && typeof f === "object") : []

/** Maps one OpenCode permission request onto the Arc approvals focus card. */
export function fromPermissionRequest(request: PermissionLike, copy: PermissionCopy, requestedAt?: number): ApprovalRequest {
  const kind = permissionKind(request.action)
  const resources = request.resources.filter(Boolean)
  const first = resources[0] ?? ""
  const previews = files(request.metadata)
  const created = kind === "edit" && previews.length === 1 && previews[0].status === "added"

  const target = kind === "shell" || kind === "web" ? clip(first) : base(first)
  const template = created ? copy.title.create : copy.title[kind]
  const title = first ? template.replace("{{target}}", `\`${target.replaceAll("`", "'")}\``) : template.replace(" {{target}}", "").replace("{{target}}", request.action)

  const args: ApprovalArgument[] = []
  if (resources.length > 0) {
    const label = kind === "shell" ? copy.command : kind === "web" ? copy.url : kind === "tool" ? copy.resource : copy.path
    args.push({ key: "resource", label, value: resources.join("\n"), mono: true })
  }
  const changes = previews
    .filter((f) => typeof f.additions === "number" && typeof f.deletions === "number")
    .map((f) => `+${f.additions} −${f.deletions}${previews.length > 1 && typeof f.file === "string" ? `  ${base(f.file)}` : ""}`)
  if (changes.length > 0) args.push({ key: "changes", label: copy.changes, value: changes.join("\n"), mono: true })
  const input = request.metadata?.input
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const text = str(value)
      if (!text || resources.includes(text)) continue
      args.push({ key: `input.${key}`, label: key, value: text, mono: true })
    }
  }
  const save = (request.save ?? []).filter(Boolean)
  if (save.length > 0) args.push({ key: "pattern", label: copy.pattern, value: `${request.action} ${save.join(", ")}`, mono: true })

  return {
    id: request.id,
    canAlways: save.length > 0,
    title,
    summary: title.replaceAll("`", ""),
    reason: request.message,
    risk: RISK[kind],
    icon: ICON[kind],
    source: copy.tool(request.action) ?? request.action,
    // The tool title already names the source ("Bash"); repeating the raw action ("shell") reads as noise.
    sourceDetail: undefined,
    requestedAt,
    args,
    patches: previews.flatMap((file) => typeof file.file === "string" && typeof file.patch === "string" && file.patch
      ? [{ file: file.file, patch: file.patch }]
      : []),
  }
}

/** Arc decision → OpenCode permission reply. */
export function toPermissionReply(decision: ApprovalDecision): "once" | "always" | "reject" {
  return decision === "approved" ? "once" : decision === "always" ? "always" : "reject"
}

/** Normalize approve/reject into OpenCode once/reject (kept for callers of the binary surface). */
export function toApprovalDecision(action: "approve" | "reject"): "once" | "reject" {
  return action === "approve" ? "once" : "reject"
}
