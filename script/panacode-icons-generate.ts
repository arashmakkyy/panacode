#!/usr/bin/env bun
/**
 * Generates packages/panacode-ui/src/icons/lucide-artwork.ts: lucide artwork (ISC) for every
 * OpenCode icon name, drawn at Arc's stroke 1.75 with round caps. Call sites keep `<Icon name=…>`.
 *
 *   bun script/panacode-icons-generate.ts [path/to/lucide-react/dist/esm/icons]
 */
import { writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const dir = process.argv[2] ?? "/workspace/arc-ref-work/recreate-arc-ai-chat/node_modules/lucide-react/dist/esm/icons"

/** OpenCode name → lucide name. Names left out keep their original artwork (brand marks, status dots). */
export const MAP: Record<string, string> = {
  // catalog.ts
  "outline-list-changelog": "list-tree",
  "outline-pair": "smartphone",
  lock: "lock",
  globe: "globe",
  "select-element": "square-dashed-mouse-pointer",
  flask: "flask-conical",
  edit: "square-pen",
  "folder-add-left": "folder-plus",
  folder: "folder",
  branch: "git-branch",
  "branch-out": "git-fork",
  "grid-plus": "layout-grid",
  help: "circle-question-mark",
  info: "info",
  "circle-exclamation": "circle-alert",
  "circle-xmark": "circle-x",
  "magnifying-glass": "search",
  "outline-magnifier-minus": "zoom-out",
  "outline-magnifier-plus": "zoom-in",
  menu: "menu",
  minus: "minus",
  plus: "plus",
  "settings-gear": "settings-2",
  "chevron-down": "chevron-down",
  collapse: "chevrons-down-up",
  check: "check",
  monitor: "monitor",
  "workspace-new": "folder-plus",
  workspace: "folder-git-2",
  "outline-worktree": "git-branch-plus",
  "outline-trash": "trash-2",
  close: "x",
  "xmark-small": "x",
  "outline-xmark": "x",
  "outline-chevron-down": "chevron-down",
  "outline-chevron-right": "chevron-right",
  "outline-dots": "ellipsis",
  expand: "chevrons-up-down",
  "outline-expand": "maximize-2",
  filetree: "folder-tree",
  split: "columns-2",
  unified: "rows-2",
  review: "file-diff",
  "window-analytics": "chart-column",
  "graduation-cap": "graduation-cap",
  "code-slash": "code",
  "outline-code-brackets": "braces",
  trash: "trash-2",
  "outline-sliders": "sliders-horizontal",
  "outline-copy": "copy",
  "outline-quote": "quote",
  "outline-arrow-left": "arrow-left",
  "outline-arrow-right": "arrow-right",
  "outline-arrow-up-right": "arrow-up-right",
  "outline-rotate-clockwise": "rotate-cw",
  "outline-globe": "globe",
  "outline-globe-plus": "globe-lock",
  "outline-cookie": "cookie",
  "outline-browser-annotate": "message-square-dashed",
  "arrow-up-right": "arrow-up-right",
  "outline-square-arrow": "square-arrow-out-up-right",
  "outline-arrow-to-corner-top-right": "arrow-up-right",
  "outline-maximize": "maximize",
  "outline-hexagonal-warning": "octagon-alert",
  "outline-share": "share",
  "outline-eye": "eye",
  "outline-eye-slash": "eye-off",
  refresh: "refresh-cw",
  reset: "rotate-ccw",
  "outline-undo": "undo-2",
  "outline-reset": "rotate-ccw",
  waveform: "audio-lines",
  "outline-steer": "navigation",
  "outline-wave-audio": "audio-waveform",
  comment: "message-square",
  archive: "archive",
  "outline-text": "type",
  "outline-photo": "image",
  "file-document": "file-text",
  "outline-audio": "file-audio",
  "outline-video": "file-video",
  "outline-brain": "brain",
  "outline-console": "square-terminal",
  // additional-icons.ts
  "align-right": "arrow-right-to-line",
  "arrow-up": "arrow-up",
  "arrow-left": "arrow-left",
  "arrow-right": "arrow-right",
  "bubble-5": "message-circle",
  prompt: "messages-square",
  brain: "brain",
  fork: "git-fork",
  "workspace-isolated": "box",
  "bullet-list": "list",
  "check-small": "check",
  "chevron-left": "chevron-left",
  "chevron-right": "chevron-right",
  "chevron-grabber-vertical": "chevrons-up-down",
  "chevron-double-right": "chevrons-right",
  "circle-x": "circle-x",
  "close-small": "x",
  checklist: "list-checks",
  console: "square-terminal",
  terminal: "square-terminal",
  "terminal-active": "square-terminal",
  "review-active": "file-diff",
  code: "code",
  "code-lines": "file-code",
  "circle-ban-sign": "ban",
  "edit-small-2": "pencil",
  eye: "eye",
  enter: "corner-down-left",
  "file-tree": "folder-tree",
  "file-tree-active": "folder-tree",
  "plus-small": "plus",
  "new-session": "square-pen",
  "new-session-active": "square-pen",
  "pencil-line": "pencil-line",
  mcp: "plug",
  glasses: "glasses",
  "magnifying-glass-menu": "search",
  "window-cursor": "app-window",
  task: "list-todo",
  stop: "square",
  sidebar: "panel-left",
  "sidebar-active": "panel-left",
  "layout-left": "panel-left",
  "layout-left-partial": "panel-left",
  "layout-left-full": "panel-left",
  "layout-right": "panel-right",
  "layout-right-partial": "panel-right",
  "layout-right-full": "panel-right",
  "layout-bottom": "panel-bottom",
  "layout-bottom-partial": "panel-bottom",
  "layout-bottom-full": "panel-bottom",
  "square-arrow-top-right": "square-arrow-out-up-right",
  "open-file": "file-symlink",
  "speech-bubble": "message-square",
  "dot-grid": "grip",
  "circle-check": "circle-check",
  copy: "copy",
  photo: "image",
  share: "share",
  shield: "shield",
  download: "download",
  server: "server",
  dash: "minus",
  "cloud-upload": "cloud-upload",
  sliders: "sliders-horizontal",
  keyboard: "keyboard",
  selector: "chevrons-up-down",
  "arrow-down-to-line": "arrow-down-to-line",
  warning: "triangle-alert",
  link: "link",
  providers: "key-round",
  models: "sparkles",
  appearance: "palette",
  notifications: "bell",
  extensions: "plug",
  cube: "box",
  "post-skill": "book-open",
  "arrow-undo-down": "undo-2",
}

type Node = [string, Record<string, string>]
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;")

async function load(name: string): Promise<string> {
  const file = join(dir, `${name}.mjs`)
  if (!existsSync(file)) throw new Error(`lucide icon not found: ${name}`)
  const alias = /from '\.\/([a-z0-9-]+)\.mjs'/.exec(await Bun.file(file).text())
  if (alias && !(await Bun.file(file).text()).includes("__iconData")) return load(alias[1])
  const mod = (await import(file)) as { __iconData?: { node: Node[] } }
  const nodes = mod.__iconData?.node
  if (!nodes) throw new Error(`lucide icon has no node data: ${name}`)
  return nodes
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== "key").map(([k, v]) => `${k}="${esc(String(v))}"`).join(" ")}/>`)
    .join("")
}

const entries: string[] = []
for (const [name, lucide] of Object.entries(MAP)) {
  const body = `<g fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${await load(lucide)}</g>`
  entries.push(`  ${JSON.stringify(name)}: ${JSON.stringify(body)},`)
}

const out = `// Generated by script/panacode-icons-generate.ts. Do not edit by hand.
// Artwork: Lucide (https://lucide.dev), ISC License, Copyright (c) Lucide Contributors.
// OpenCode icon name -> lucide artwork on a 24px grid at Arc's stroke 1.75.

export const lucideViewBox = "0 0 24 24"

export const lucideArtwork: Record<string, string> = {
${entries.join("\n")}
}
`
const target = join(import.meta.dir, "../packages/panacode-ui/src/icons/lucide-artwork.ts")
writeFileSync(target, out)
console.log(`wrote ${Object.keys(MAP).length} icons to ${target}`)
