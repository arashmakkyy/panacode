import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { roots } from "@opencode/util/global-roots"
import { ProductIdentity } from "@opencode/util/product-identity"
import { OPENCODE_CHANNEL } from "./version"

const sidecars = ["", "-wal", "-shm", "-journal"] as const

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
  refuseForeignDatabase(resolved)
  return resolved
}

function refuseForeignDatabase(file: string) {
  try {
    assertPrivate(file)
  } catch (error) {
    if (error instanceof Refusal) throw error
    throw refusal("the database path cannot be verified safely")
  }
}

function assertPrivate(file: string) {
  const protectedRoots = opencodeRoots().map(canonical)
  for (const suffix of sidecars) {
    const candidate = `${file}${suffix}`
    const target = canonical(candidate)
    if (protectedRoots.some((root) => contained(root, target))) {
      throw refusal("that path belongs to OpenCode data")
    }
    refuseSharedFile(candidate)
  }
}

// Every private root this checkout can use, plus the pre-XDG fallbacks. An inherited OPENCODE_DB is
// not read; these are locations, not environment overrides.
function opencodeRoots() {
  const root = roots(ProductIdentity.upstreamSlug)
  const home = os.homedir()
  const fallback = home
    ? [
        path.join(home, ".local", "share", ProductIdentity.upstreamSlug),
        path.join(home, ".local", "state", ProductIdentity.upstreamSlug),
        path.join(home, ".cache", ProductIdentity.upstreamSlug),
        path.join(home, ".config", ProductIdentity.upstreamSlug),
      ]
    : []
  return [root.data, root.cache, root.config, root.state, root.tmp, ...fallback]
}

// SQLite follows links for the database and for -wal/-shm/-journal. Resolve the nearest existing
// parent so a missing file under an alias is judged by where it would actually be created. A broken
// link is refused instead of being confused with an ordinary missing name.
function canonical(input: string) {
  let current = path.resolve(input)
  const missing: string[] = []

  for (;;) {
    const entry = lstat(current)
    if (entry !== undefined) {
      try {
        return path.join(fs.realpathSync.native(current), ...missing)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" && entry.isSymbolicLink()) {
          throw refusal("a link in the database path is broken")
        }
        throw error
      }
    }
    const parent = path.dirname(current)
    if (parent === current) return path.join(current, ...missing)
    missing.unshift(path.basename(current))
    current = parent
  }
}

// On Windows a junction is reported as a symbolic link by lstat and resolved by realpath.
function lstat(file: string) {
  try {
    return fs.lstatSync(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

// A hard link gives the same file another name, so a private path can still be OpenCode's bytes.
// A regular file with more than one link cannot prove its owner; fail closed. Directories are not
// databases and keep their ordinary link count.
function refuseSharedFile(file: string) {
  let stats: fs.Stats
  try {
    stats = fs.statSync(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
  if (stats.isFile() && stats.nlink > 1) {
    throw refusal("a database file or sidecar has multiple hard links, so its ownership cannot be proven")
  }
}

// Segment-boundary containment: "..notes" is a legal child name, while "../opencode-backup" is a
// sibling. path.relative handles Windows case folding, drives and UNC roots.
function contained(root: string, file: string) {
  const relative = path.relative(root, file)
  if (relative === "") return true
  if (path.isAbsolute(relative)) return false
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !relative.startsWith("../")
}

class Refusal extends Error {}

function refusal(reason: string) {
  return new Refusal(
    `Refusing PANACODE_DB: ${reason}. Set PANACODE_DB to a private Panacode path or unset it.`,
  )
}