#!/usr/bin/env bun
/**
 * Guards the Panacode/OpenCode runtime boundary.
 *
 * Product code reads PANACODE_* only. Ambient OPENCODE_* variables must not move Panacode's
 * database, configuration, service registration, sidecars, or child processes. Two deliberate
 * exceptions remain: the CLI scrubs inherited passwords, and the OpenCode-hosted model provider
 * keeps its provider credential name.
 *
 * It also rejects the three product paths that crossed the boundary before: a remote `dev/install`
 * script, a bare `opencode-pty` executable resolved through PATH, and an upstream `@opencode/cli`
 * artifact download. These static checks complement the behavioral tests; they do not replace them.
 *
 *   bun script/panacode-isolation-check.ts
 */
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const roots: ReadonlyArray<readonly [string, string]> = [
  ["packages/app/src", "**/*.{ts,tsx}"],
  ["packages/cli/bin", "*.cjs"],
  ["packages/cli/src", "**/*.{ts,tsx}"],
  ["packages/client/src", "**/*.{ts,tsx}"],
  ["packages/core/src", "**/*.{ts,tsx}"],
  ["packages/desktop/src", "**/*.{ts,tsx}"],
  ["packages/gui-plugins/src", "**/*.{ts,tsx}"],
  ["packages/plugin/src", "**/*.{ts,tsx}"],
  ["packages/server/src", "**/*.{ts,tsx}"],
  ["packages/simulation/src", "**/*.{ts,tsx}"],
  ["packages/tui/src", "**/*.{ts,tsx}"],
  ["packages/util/src", "**/*.{ts,tsx}"],
]

const allowed = new Map<string, ReadonlySet<string>>([
  ["packages/cli/src/server-process.ts", new Set(["OPENCODE_PASSWORD", "OPENCODE_SERVER_PASSWORD"])],
  ["packages/core/src/plugin/provider/opencode.ts", new Set(["OPENCODE_API_KEY"])],
])

const violations: string[] = []

for (const [directory, pattern] of roots) {
  for (const file of new Bun.Glob(pattern).scanSync({ cwd: path.join(root, directory) })) {
    const relative = `${directory}/${file}`.replaceAll("\\", "/")
    if (relative.includes(".test.") || relative.includes(".stories.")) continue
    if (/(?:^|\/)(?:generated|stories|storybook|test)\//.test(relative)) continue
    const text = await Bun.file(path.join(root, directory, file)).text()
    // `import.meta.env.OPENCODE_*` is a build-time constant, not an ambient runtime variable.
    for (const match of text.matchAll(/(?:process\.env|(?<![.\w])env)\.(OPENCODE_[A-Z0-9_]+)/g)) {
      const key = match[1]!
      if (allowed.get(relative)?.has(key)) continue
      violations.push(`${relative}: ${key}`)
    }
  }
}

// The exact shapes that were reintroduced before. Each rule is scoped to the product paths that
// own it, so documentation and test fixtures elsewhere do not trip it.
const forbidden: ReadonlyArray<{
  readonly reason: string
  readonly directories: ReadonlyArray<string>
  readonly pattern: RegExp
}> = [
  {
    reason: "remote dev installer",
    directories: ["packages/cli/src", "packages/gui-plugins/src"],
    pattern: /dev\/install/g,
  },
  {
    reason: "bare persistent PTY executable name",
    directories: ["packages/cli/src", "packages/core/src", "packages/desktop/src"],
    pattern:
      /(?:PANACODE_PTY_BIN\s*\|\|\s*|\b(?:spawn|which|resolveBinary|command|binary)\s*[=(]?\s*\[?\s*)["'`]opencode-pty(?:\.exe)?["'`]/g,
  },
  {
    reason: "upstream CLI artifact download",
    directories: ["packages/cli/src", "packages/desktop/script", "packages/desktop/src", "packages/gui-plugins/src"],
    pattern:
      /@opencode\/cli-(?:linux|darwin|windows)|downloadCliToResources|opencode\.ai\/install|github\.com\/sst\/opencode/g,
  },
]

for (const rule of forbidden) {
  for (const directory of rule.directories) {
    for (const file of new Bun.Glob("**/*.{ts,tsx,js,mjs,cjs}").scanSync({ cwd: path.join(root, directory) })) {
      if (file.includes(".test.") || file.includes(".stories.")) continue
      if (/(?:^|\/)(?:generated|test)\//.test(file)) continue
      const text = await Bun.file(path.join(root, directory, file)).text()
      for (const match of text.matchAll(rule.pattern)) {
        violations.push(`${directory}/${file}: ${rule.reason}: ${match[0]}`)
      }
    }
  }
}

const scripts: Record<string, string> = (await Bun.file(path.join(root, "package.json")).json()).scripts
for (const name of ["dev:live", "dev:vite:live"]) {
  if (scripts[name]?.includes("OPENCODE_")) violations.push(`package.json: ${name} sets an OPENCODE_* variable`)
}

if (violations.length > 0) {
  console.error("Panacode runtime isolation is broken:")
  for (const violation of violations) console.error(`  ${violation}`)
  process.exit(1)
}

console.log("Panacode runtime isolation holds: product code reads PANACODE_* only.")