import os from "node:os"
import path from "node:path"
import { roots } from "@opencode/util/global-roots"
import { ProductIdentity } from "@opencode/util/product-identity"
import { OPENCODE_CHANNEL } from "./version"

/**
 * Resolve the Panacode database path.
 *
 * Only PANACODE_DB is accepted. An inherited OPENCODE_DB must not move Panacode's database, and
 * a custom path must not point at a known OpenCode store: writing there would corrupt another
 * product's sessions and credentials.
 */
export function databasePath(data: string) {
  const configured = process.env.PANACODE_DB
  const filename =
    configured ??
    (["latest", "dev", "beta", "next", "prod"].includes(OPENCODE_CHANNEL) ||
    process.env.PANACODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.PANACODE_DISABLE_CHANNEL_DB === "true"
      ? "panacode.db"
      : `panacode-${OPENCODE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
  if (filename === ":memory:") return filename
  const resolved = path.resolve(data, filename)
  if (foreignDatabase(resolved)) {
    throw new Error(
      `Refusing to use ${resolved} as Panacode's database: that path belongs to another product. ` +
        "Set PANACODE_DB to a Panacode path or unset it.",
    )
  }
  return resolved
}

function foreignDatabase(file: string) {
  const base = path.basename(file).toLowerCase()
  if (/^opencode(?:-[^/\\]*)?\.db$/.test(base)) return true
  return [roots(ProductIdentity.upstreamSlug).data, path.join(os.homedir(), ".local", "share", "opencode")].some(
    (root) => contained(root, file),
  )
}

function contained(root: string, file: string) {
  const relative = path.relative(path.resolve(root), file)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
