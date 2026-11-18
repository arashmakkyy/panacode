#!/usr/bin/env bun
/**
 * User-visible brand scan for Panacode.
 *
 * Checks locale files and the UI/CLI/TUI/desktop sources that ship in the app
 * (and dist/out bundles when they exist) for "opencode" / "OpenCode".
 * Internal identifiers, license attribution, and upstream product names that
 * are still the real service a person signs into are allowlisted in
 * script/panacode-brand-allowlist.txt.
 *
 *   bun script/panacode-brand-scan.ts            # fail on leftovers
 *   bun script/panacode-brand-scan.ts --inventory
 *   bun script/panacode-brand-scan.ts --write    # rewrite visible product-name copy
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

const root = join(import.meta.dir, "..")
const write = process.argv.includes("--write")
const inventory = process.argv.includes("--inventory")

const roots = [
  "packages/app/src",
  "packages/desktop/src",
  "packages/desktop/script",
  "packages/desktop/resources",
  "packages/ui/src",
  "packages/cli/src",
  "packages/tui/src",
  "packages/gui-plugins/src",
  "packages/session-ui/src",
  "packages/plugin/src",
  "packages/core/src",
]

const built = ["packages/app/dist", "packages/desktop/out", "packages/desktop/dist"]

const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".html", ".css", ".desktop", ".xml"])

function skip(path: string) {
  return (
    path.includes(`${sep}node_modules${sep}`) ||
    path.includes(".test.") ||
    path.includes(".stories.") ||
    path.includes(`${sep}test${sep}`) ||
    path.includes(`${sep}generated${sep}`) ||
    path.includes(`${sep}storybook${sep}`) ||
    path.includes(`${sep}stories${sep}`) ||
    path.includes(".stories.") ||
    path.endsWith(".map") ||
    path.endsWith(".png") ||
    path.endsWith(".svg") ||
    path.endsWith(".ico") ||
    path.endsWith(".icns")
  )
}

const sep = "/"

function walk(dir: string, out: string[]) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const rel = relative(root, path).split("\\").join("/")
    if (skip(`/${rel}`)) continue
    const info = statSync(path)
    if (info.isDirectory()) walk(path, out)
    else if (extensions.has(ext(name))) out.push(path)
  }
}

function ext(name: string) {
  const index = name.lastIndexOf(".")
  return index < 0 ? "" : name.slice(index)
}

const allowPhrases = readFileSync(join(import.meta.dir, "panacode-brand-allowlist.txt"), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))

function category(path: string) {
  const rel = relative(root, path).split("\\").join("/")
  if (rel.includes("/i18n/")) return "i18n"
  if (rel.includes("/cli/")) return "cli"
  if (rel.includes("/tui/")) return "tui"
  if (rel.endsWith(".desktop") || rel.endsWith("package.json") || rel.includes("metainfo") || rel.includes("electron-builder"))
    return "installer-metadata"
  if (rel.includes("/splash") || rel.includes("wordmark") || rel.includes("/logo")) return "logos"
  if (rel.includes("/about/")) return "about"
  if (rel.includes("menu")) return "menus"
  if (rel.includes("/dist/") || rel.includes("/out/")) return "built-assets"
  return "ui-source"
}

function shielded(value: string) {
  let rest = value
  for (const phrase of allowPhrases) rest = rest.split(phrase).join("")
  return rest
}

function visibleHit(value: string) {
  const trimmed = value.trim()
  if (!/\s/.test(trimmed)) {
    if (/opencode\.ai\/(docs|desktop-feedback)|discord\.com\/invite\/opencode|github\.com\/anomalyco\/opencode|www\.opencode\.ai/i.test(trimmed))
      return true
    return false
  }
  const rest = shielded(value)
  return /opencode/i.test(rest)
}

const shields = [
  "OpenCode Go",
  "OpenCode Console",
  "OpenCode Zen",
  "OpenCode Free",
  "OpenCode is a trademark of Anomaly Innovations, Inc.",
  "Forked from OpenCode",
]

function rewriteValue(value: string) {
  if (!/opencode/i.test(value)) return value
  if (value.includes("www.opencode.ai")) value = value.replaceAll("www.opencode.ai", "panaai-psi.vercel.app")
  // Keys, ids, URLs, and filenames have no spaces and no OpenCode/OPENCODE token.
  if (!/\s/.test(value) && !/OpenCode|OPENCODE/.test(value)) return value

  let next = value
  const held: string[] = []
  const hold = (phrase: string) => {
    const token = `\u0000${held.length}\u0000`
    held.push(phrase)
    return token
  }
  for (const phrase of shields) next = next.split(phrase).join(hold(phrase))
  next = next.replace(/OpenCode(?![A-Z0-9_])/g, "Panacode")
  next = next.replace(/Opencode(?![-])/g, "Panacode")
  next = next.replace(/OPENCODE(?!_)/g, "PANACODE")
  next = next.replaceAll("opencode.jsonc", "panacode.jsonc")
  next = next.replaceAll("opencode.json", "panacode.json")
  next = next.replaceAll("opencode pair", "panacode pair")
  next = next.replace(/(?<![@/.\w])opencode2(?![\w])/g, "panacode")
  next = next.replace(/(?<![@/.\w-])opencode(?!-[A-Za-z0-9])/g, "panacode")
  held.forEach((phrase, index) => {
    next = next.split(`\u0000${index}\u0000`).join(phrase)
  })
  return next
}

/** Single-line strings and single-line JSX text only. Never rescan the rest of a file. */
function rewriteSource(source: string) {
  const withStrings = source.replace(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, (literal) => {
    if (literal.length < 2 || literal[0] !== literal.at(-1)) return literal
    const quote = literal[0] ?? '"'
    return quote + rewriteValue(literal.slice(1, -1)) + quote
  })

  return withStrings.replace(/>([^<>{}\n]*OpenCode[^<>{}\n]*)</g, (_match, text: string) => {
    return `>${rewriteValue(text)}<`
  })
}

type Hit = { path: string; category: string; line: number; text: string }

function pieceHits(path: string, source: string): Hit[] {
  const rel = relative(root, path).split("\\").join("/")
  const hits: Hit[] = []
  const consider = (value: string, at: number) => {
    if (!/opencode/i.test(value) || !visibleHit(value)) return
    hits.push({ path: rel, category: category(path), line: at, text: value.trim().slice(0, 180) })
  }
  source.split("\n").forEach((line, index) => {
    const trimmed = line.trimStart()
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return
    const strings = /(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g
    let match: RegExpExecArray | null
    while ((match = strings.exec(line))) consider(match[0].slice(1, -1), index + 1)
    const jsx = />([^<>{}\n]*)</g
    while ((match = jsx.exec(line))) consider(match[1] ?? "", index + 1)
  })
  return hits
}

function rawHits(path: string, source: string): Hit[] {
  const rel = relative(root, path).split("\\").join("/")
  const hits: Hit[] = []
  source.split("\n").forEach((line, index) => {
    if (!/opencode/i.test(line)) return
    if (path.endsWith(".css") && !/OpenCode|opencode\.ai|discord\.com\/invite\/opencode/.test(line)) return
    if (!visibleHit(line)) return
    hits.push({
      path: rel,
      category: category(path),
      line: index + 1,
      text: line.trim().slice(0, 180),
    })
  })
  return hits
}

const files: string[] = []
for (const item of roots) walk(join(root, item), files)
for (const item of built) walk(join(root, item), files)

let rewritten = 0
if (write) {
  for (const file of files) {
    if (file.endsWith(".css")) continue
    const before = readFileSync(file, "utf8")
    const after = rewriteSource(before)
    if (after !== before) {
      writeFileSync(file, after)
      rewritten++
    }
  }
  console.log(`rewrote ${rewritten} files`)
}

const counts = new Map<string, number>()
const hits: Hit[] = []
for (const file of files) {
  const source = readFileSync(file, "utf8")
  const code = /\.(tsx?|jsx?|mjs|cjs)$/.test(file)
  for (const hit of code ? pieceHits(file, source) : rawHits(file, source)) {
    counts.set(hit.category, (counts.get(hit.category) ?? 0) + 1)
    hits.push(hit)
  }
}

const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1])
console.log(inventory ? "inventory" : "leftovers")
for (const [name, count] of ordered) console.log(`${count}\t${name}`)
console.log(`total\t${hits.length}`)

if (inventory) {
  for (const hit of hits.slice(0, 80)) console.log(`${hit.category}:${hit.path}:${hit.line}:${hit.text}`)
  process.exit(0)
}

if (hits.length) {
  for (const hit of hits.slice(0, 60)) console.error(`${hit.path}:${hit.line}: ${hit.text}`)
  if (hits.length > 60) console.error(`… ${hits.length - 60} more`)
  console.error("panacode-brand-scan failed. Allowlist only internal ids, license attribution, and upstream service names.")
  process.exit(1)
}

console.log("panacode-brand-scan ok")
