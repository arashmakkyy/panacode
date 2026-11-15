#!/usr/bin/env bun
/**
 * Build the current-platform Panacode CLI and install it to ~/.panacode/bin.
 * Does not publish to npm. Safe alongside an OpenCode install.
 *
 * Usage: bun run script/install-local.ts [--no-modify-path]
 */
import { $ } from "bun"
import path from "node:path"
import { existsSync } from "node:fs"

const root = path.resolve(import.meta.dir, "..")
const cli = path.join(root, "packages/cli")
const noModifyPath = process.argv.includes("--no-modify-path")

process.chdir(cli)
console.log("=== building panacode CLI (single target) ===")
await $`bun run script/build.ts --single --skip-web-ui`

const platform = process.platform === "win32" ? "windows" : process.platform
const arch = process.arch === "arm64" ? "arm64" : "x64"
const binaryName = process.platform === "win32" ? "panacode.exe" : "panacode"
const candidates = [
  path.join(cli, "dist", `cli-${platform}-${arch}`, "bin", binaryName),
  path.join(cli, "dist", `cli-${platform}-${arch}-baseline`, "bin", binaryName),
]
const binary = candidates.find((candidate) => existsSync(candidate))
if (!binary) {
  console.error("Built binary not found. Looked for:")
  for (const candidate of candidates) console.error(`  ${candidate}`)
  process.exit(1)
}

console.log(`=== installing ${binary} ===`)
const args = ["--binary", binary]
if (noModifyPath) args.push("--no-modify-path")
await $`${path.join(root, "install")} ${args}`
