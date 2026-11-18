#!/usr/bin/env bun
/**
 * Static ownership guard for the Panacode UI overlay.
 * Fails when React demo packages leak into production workspace deps,
 * or when the Panacode design package / merge guide are missing.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const failures: string[] = []

const required = [
  "packages/panacode-ui/package.json",
  "packages/panacode-ui/src/index.ts",
  "packages/panacode-ui/src/primitives/switch.tsx",
  "packages/panacode-ui/src/primitives/button.tsx",
  "packages/panacode-ui/src/primitives/dialog.tsx",
  "packages/panacode-ui/src/primitives/menu.tsx",
  "packages/panacode-ui/src/primitives/select.tsx",
  "packages/panacode-ui/src/shell/frame.tsx",
  "packages/panacode-ui/src/motion/spring.ts",
  "packages/panacode-ui/src/styles/shell.css",
  "packages/ui/src/theme/themes/panacode.json",
  "panacode-docs/UPSTREAM-MERGE.md",
  "panacode-docs/redesign/RUNNING.md",
  "script/panacode-brand-scan.ts",
  "script/panacode-brand-allowlist.txt",
]

for (const path of required) {
  if (!existsSync(join(root, path))) failures.push(`missing required Panacode file: ${path}`)
}

const appPkg = JSON.parse(readFileSync(join(root, "packages/app/package.json"), "utf8")) as {
  dependencies?: Record<string, string>
}
if (!appPkg.dependencies?.["@panacode/ui"]) failures.push("packages/app must depend on @panacode/ui")

const forbidden = ["react", "react-dom", "@radix-ui/react-switch"]
for (const name of forbidden) {
  if (appPkg.dependencies?.[name]) failures.push(`packages/app must not depend on ${name} (use SolidJS Panacode ports)`)
}

const appEntry = readFileSync(join(root, "packages/app/src/app.tsx"), "utf8")
if (!appEntry.includes("PANACODE_THEME_ID") || !appEntry.includes("defaultTheme")) {
  failures.push("packages/app/src/app.tsx must default ThemeProvider to Panacode theme")
}
if (!appEntry.includes('dataset.brand = "panacode"') && !appEntry.includes("data-brand")) {
  failures.push("packages/app/src/app.tsx must mark the document with Panacode brand hooks")
}
if (!appEntry.includes('defaultColorScheme="dark"')) {
  failures.push('packages/app/src/app.tsx must default the color scheme to dark')
}

const tokens = readFileSync(join(root, "packages/panacode-ui/src/theme/tokens.css"), "utf8")
if (!tokens.includes('[data-color-scheme="dark"]')) {
  failures.push("Panacode tokens must switch on data-color-scheme=dark")
}
if (tokens.includes(':root[data-theme="dark"]')) {
  failures.push('Panacode tokens must not key dark mode off data-theme="dark"')
}
if (/^:focus-visible/m.test(tokens) || /outline:\s*none\s*!important/.test(tokens)) {
  failures.push("Panacode focus styles must stay on Panacode primitives, not the global document")
}

if (failures.length) {
  console.error("panacode-ui-ownership-check failed:\n - " + failures.join("\n - "))
  process.exit(1)
}
console.log("panacode-ui-ownership-check ok")
