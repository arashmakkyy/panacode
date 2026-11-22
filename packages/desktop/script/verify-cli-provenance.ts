#!/usr/bin/env bun
import path from "node:path"
import { readFile } from "node:fs/promises"
import packageInfo from "../package.json"
import { getConfig } from "../electron-builder.config"
import { verifyWindowsPayload } from "./verify-windows-payload"
import { ProductIdentity } from "@opencode/util/product-identity"
import { getCurrentCli, provenanceFile, verifyPackagedCli, versionFile } from "./utils"

// Verifies the CLI in an unpacked or installed app against the provenance written from packages/cli/dist.
// usage: bun ./script/verify-cli-provenance.ts [resources-directory]
const dir = path.resolve(import.meta.dir, "..")

const cli = getCurrentCli()

const resources = path.resolve(process.argv[2] ?? path.join(dir, "dist", "win-unpacked", "resources"))

const name = cli.os === "win32" ? `${ProductIdentity.cli}-cli.exe` : `${ProductIdentity.cli}-cli`

const binary = path.join(resources, name)

const bundled = await verifyPackagedCli({
  binary,
  versionFile: versionFile(binary),
  provenanceFile: provenanceFile(binary),
  target: cli,
})

console.log(`Bundled CLI: \`${name}\``)

console.log(`Version: \`${bundled.version}\``)

console.log(`Source sha256: \`${bundled.sourceSha256}\``)

console.log(`Unpacked sha256: \`${bundled.sha256}\``)

if (!process.argv[2] && cli.os === "win32") {
  const { appId, productName } = getConfig()
  if (!appId || !productName) throw new Error("Missing Windows packaging identity")
  const buildPin = await readFile(path.join(dir, "dist", `${appId}-${cli.cpu}.manifest.sha256`), "utf8")
  await verifyWindowsPayload({
    installer: path.resolve(dir, "../../dist/desktop", `panacode-desktop-win-${cli.cpu}.exe`),
    buildPin,
    version: process.env.OPENCODE_VERSION || packageInfo.version,
    helper: path.join(dir, "resources/windows/install-files.ps1"),
    appId,
    executable: productName + ".exe",
  })
}
