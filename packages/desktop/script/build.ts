#!/usr/bin/env bun
import { $ } from "bun"
import path from "node:path"
import { copyBuiltCliToResources, resolveChannel } from "./utils"
import { verifyBundles } from "./verify-bundles"

// Prepares resources/ (icons, metainfo, the bundled CLI) for OPENCODE_CHANNEL and builds the app into out/.
// The CLI always comes from ../cli/dist, built from this checkout. Panacode publishes no downloadable CLI,
// so there is no upstream package fallback.
const dir = path.resolve(import.meta.dir, "..")

const cli = path.resolve(dir, "../cli/dist")

const channel = resolveChannel()

process.chdir(dir)

await $`bun ./script/copy-icons.ts ${channel}`

await $`bun ./script/copy-metainfo.ts ${channel}`

await copyBuiltCliToResources(cli, undefined, { version: process.env.OPENCODE_VERSION })

await $`bunx electron-vite build`

await verifyBundles(path.join(dir, "out"))
