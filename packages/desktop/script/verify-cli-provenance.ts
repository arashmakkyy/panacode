#!/usr/bin/env bun
import path from "node:path"
import { ProductIdentity } from "@opencode/util/product-identity"
import { getCurrentCli, provenanceFile, verifyPackagedCli, versionFile } from "./utils"

// Verifies the CLI in an unpacked or installed app against the provenance written from packages/cli/dist.
// usage: bun ./script/verify-cli-provenance.ts [resources-directory]
const dir = path.resolve(import.meta.dir, "..")

const cli = getCurrentCli()

const resources = path.resolve(process.argv[2] ?? path.join(dir, "dist", "win-unpacked", "resources"))

const name = cli.os === "win32" ? `${ProductIdentity.cli}-cli.exe` : `${ProductIdentity.cli}-cli`

const binary = path.join(resources, name)

const staged = path.join(dir, "resources", name)

const bundled = await verifyPackagedCli({
  binary,
  versionFile: versionFile(binary),
  provenanceFile: provenanceFile(staged),
  target: cli,
})

console.log(`Bundled CLI: \`${name}\``)

console.log(`Version: \`${bundled.version}\``)

console.log(`Source sha256: \`${bundled.sourceSha256}\``)

console.log(`Unpacked sha256: \`${bundled.sha256}\``)
