import fs from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { assertIsolatedSqlite, physicalPath, sqliteSuffixes, upstreamRoots, within } from "@opencode/util/product-path"
import { OPENCODE_CHANNEL } from "./version"

/**
 * Resolve the Panacode database path.
 *
 * Only PANACODE_DB is accepted. An inherited OPENCODE_DB must not move Panacode's database, and
 * a custom path must not point at a known OpenCode store: writing there would corrupt another
 * product's sessions and credentials.
 *
 * This runs before the database file is created, before SQLite opens it and before any migration.
 * It rejects links and links through existing parents, because a lexical comparison cannot prove
 * where SQLite will write. A one-shot check cannot defend against a concurrent link swap between
 * this function and the driver's open; that limitation is part of the filesystem API.
 */
export function databasePath(data: string, claimExternal = false) {
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
  try {
    const privateData = physicalPath(data)
    const physical = physicalPath(resolved)
    const external = !within(privateData, physical)
    assertIsolatedSqlite(resolved, external)
    if (external) {
      checkExternalDatabase(privateData, physical, claimExternal)
      assertIsolatedSqlite(resolved)
    }
  } catch (error) {
    if (error instanceof Refusal) throw error
    throw refusal("the database path cannot be verified safely")
  }
  return resolved
}

// Older Panacode and OpenCode databases have indistinguishable schemas. Keep external ownership
// receipts inside global.data. A receipt names a specific file identity *and* destination. Publish
// the receipt before linking a fresh empty inode to its final name so a crash cannot strand the
// official path without proof. Never open an extra SQLite descriptor: closing it releases locks.
function checkExternalDatabase(data: string, physical: string, claim: boolean) {
  if (upstreamRoots().some((root) => within(root, data))) throw refusal("the product data directory is shared")
  const directory = path.join(data, "database-owners")
  if (path.relative(directory, physicalPath(directory)) !== "") throw refusal("unsafe ownership directory")
  const parent = path.dirname(physical)
  const receipt = (info: fs.BigIntStats) => {
    const identity = [
      process.platform === "win32" ? physical.toLowerCase() : physical,
      ...[info.dev, info.ino, info.birthtimeNs].map(String),
    ]
    return path.join(directory, createHash("sha256").update(JSON.stringify(identity)).digest("hex"))
  }
  const verify = (existing: fs.BigIntStats) => {
    const marker = receipt(existing)
    const info = fs.lstatSync(marker, { throwIfNoEntry: false })
    if (!info?.isFile() || info.nlink !== 1 || info.size !== 36)
      throw refusal("ownership of the existing external database is unknown")
    if (existing.nlink === 1n) return
    const id = fs.readFileSync(marker, "utf8")
    if (!/^[a-f0-9-]{36}$/.test(id)) throw refusal("invalid ownership record")
    const temporary = path.join(parent, `.panacode-db-${id}.tmp`)
    const stage = fs.lstatSync(temporary, { bigint: true, throwIfNoEntry: false })
    if (!stage && fs.lstatSync(physical, { bigint: true }).nlink === 1n) return
    if (!stage || !stage.isFile() || stage.dev !== existing.dev || stage.ino !== existing.ino || existing.nlink !== 2n)
      throw refusal("the external database has shared links")
    // Complete the only remaining step if a creator was interrupted after linking its file.
    fs.rmSync(temporary, { force: true })
  }
  const existing = fs.lstatSync(physical, { bigint: true, throwIfNoEntry: false })
  if (existing) return verify(existing)
  if (!claim) return
  if (sqliteSuffixes.slice(1).some((suffix) => fs.lstatSync(physical + suffix, { throwIfNoEntry: false })))
    throw refusal("there are pre-existing external database sidecars")
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 })
  const id = crypto.randomUUID()
  const stage = path.join(parent, `.panacode-db-${id}.tmp`)
  const fd = fs.openSync(stage, "wx", 0o600)
  const marker = (() => {
    try {
      return receipt(fs.fstatSync(fd, { bigint: true }))
    } finally {
      fs.closeSync(fd)
    }
  })()
  try {
    fs.writeFileSync(marker, id, { flag: "wx", mode: 0o600, flush: true })
    try {
      fs.linkSync(stage, physical)
    } catch (error) {
      fs.rmSync(marker, { force: true })
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
      verify(fs.lstatSync(physical, { bigint: true }))
    }
  } finally {
    fs.rmSync(stage, { force: true })
  }
  verify(fs.lstatSync(physical, { bigint: true }))
}

class Refusal extends Error {}

function refusal(reason: string) {
  return new Refusal(`Refusing PANACODE_DB: ${reason}. Set PANACODE_DB to a private Panacode path or unset it.`)
}
