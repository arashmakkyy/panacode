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
  "packages/panacode-ui/src/styles/shell.css",
  "packages/ui/src/theme/themes/panacode.json",
  "panacode-docs/UPSTREAM-MERGE.md",
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

if (failures.length) {
  console.error("panacode-ui-ownership-check failed:\n - " + failures.join("\n - "))
  process.exit(1)
}
console.log("panacode-ui-ownership-check ok")
