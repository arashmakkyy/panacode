import { lstatSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { privateDirectory } from "@opencode/util/private-directory"
import { assertIsolatedSqlite, sqliteSuffixes } from "@opencode/util/product-path"

export function openPrivateSqlite(filename: string) {
  if (filename === ":memory:") return new DatabaseSync(filename)
  const file = path.join(privateDirectory(path.dirname(filename)), path.basename(filename))
  // Desktop storage belongs directly to userData. An ordinary file in some other directory
  // is still foreign when reached through a link here, including SQLite's sidecar files.
  if (sqliteSuffixes.some((suffix) => lstatSync(file + suffix, { throwIfNoEntry: false })?.isSymbolicLink()))
    throw new Error("Refusing a redirected Panacode desktop database")
  assertIsolatedSqlite(file)
  return new DatabaseSync(file)
}
