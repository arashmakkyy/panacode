import fs from "node:fs"
import path from "node:path"
import { roots, hostFilesystem, upstreamFallbackRoots } from "#global-roots"
import { privateDirectory } from "./private-directory.js"
import { ProductIdentity } from "./product-identity.js"

export const sqliteSuffixes = ["", "-wal", "-shm", "-journal"] as const

export function within(directory: string, candidate: string) {
  const relative = path.relative(directory, candidate)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

// Resolve missing children via their nearest existing ancestor. An existing dangling link or an
// inaccessible ancestor is an error, never evidence that the path is unused.
export function physicalPath(file: string): string {
  const absolute = path.resolve(file)
  if (!hostFilesystem) return absolute
  if (fs.lstatSync(absolute, { throwIfNoEntry: false })) return fs.realpathSync.native(absolute)
  const parent = path.dirname(absolute)
  if (parent === absolute) throw new Error("Unavailable filesystem root")
  return path.join(physicalPath(parent), path.basename(absolute))
}

export function upstreamRoots() {
  const name = ProductIdentity.upstreamSlug
  const known = [...Object.values(roots(name)), ...upstreamFallbackRoots(name)]
  return [
    ...new Set(
      known.flatMap((directory) => {
        if (!hostFilesystem) return [directory]
        try {
          return [directory, physicalPath(directory)]
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              ["ENOENT", "EACCES", "EPERM", "ELOOP", "ENOTDIR"].includes(String(error.code))
            )
          )
            throw error
          // An inaccessible or dangling upstream root must not break ordinary independent paths.
          // Preserve its lexical location and, for a dangling root link, its intended target too.
          try {
            const target = fs.readlinkSync(directory)
            return [directory, path.resolve(path.dirname(directory), target)]
          } catch {
            return [directory]
          }
        }
      }),
    ),
  ]
}

export function assertIsolatedSqlite(file: string, allowSharedTarget = false) {
  if ([file, physicalPath(file)].some((name) => /^opencode(?:-[^/\\]*)?\.db$/i.test(path.basename(name))))
    throw new Error("The database name is reserved by OpenCode")
  const protectedRoots = upstreamRoots()
  // SQLite resolves the main file before choosing its sidecar names. Other startup code also
  // uses the supplied name, so validate both namespaces if the database itself is a link.
  for (const base of new Set([file, physicalPath(file)])) {
    for (const suffix of sqliteSuffixes) {
      const target = physicalPath(base + suffix)
      if (protectedRoots.some((root) => within(root, target)))
        throw new Error("SQLite path belongs to another application")
      const info = fs.statSync(target, { throwIfNoEntry: false })
      if (info && (!info.isFile() || (info.nlink !== 1 && !(allowSharedTarget && !suffix && info.nlink === 2))))
        throw new Error("SQLite path is shared or unsafe")
    }
  }
}

export function privateInput(file: string, sqlite = false) {
  // A legacy input lives directly in its product directory. Do not follow an alias at either
  // component; the XDG base itself may be intentionally relocated.
  try {
    const parent = path.dirname(path.resolve(file))
    if (hostFilesystem) privateDirectory(parent)
    else if (!fs.lstatSync(parent).isDirectory()) return false
    const foreign = upstreamRoots()
    for (const suffix of sqlite ? sqliteSuffixes : [""]) {
      const entry = file + suffix
      if (foreign.some((root) => within(root, physicalPath(entry)))) return false
      const info = fs.lstatSync(entry, { throwIfNoEntry: false })
      if (!info && suffix) continue
      if (!info?.isFile() || info.nlink !== 1) return false
    }
    return true
  } catch {
    return false
  }
}

export function nativeConfigPath(file: string, directory = false) {
  try {
    const physical = physicalPath(file)
    const legacy = (p: string) =>
      p.toLowerCase().split(path.sep).includes(".opencode") || /^opencode\.jsonc?$/i.test(path.basename(p))
    if (legacy(file) || legacy(physical) || upstreamRoots().some((root) => within(root, physical))) return false
    const info = fs.statSync(physical, { throwIfNoEntry: false })
    return !info || (directory ? info.isDirectory() : info.isFile() && info.nlink === 1)
  } catch {
    return false
  }
}
