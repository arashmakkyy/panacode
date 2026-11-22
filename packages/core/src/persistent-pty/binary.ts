import { createHash } from "node:crypto"
import type { Stats } from "node:fs"
import { lstat, readFile } from "node:fs/promises"
import path from "node:path"

export type Asset = { readonly path: string; readonly version: string; readonly sha256: string }

export function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

// A dependency or an explicit override is only usable as an absolute, ordinary file. A bare name
// would let PATH choose the daemon, and a link could change the executable between this check and
// the spawn. The internal file name of the pinned dependency may stay "opencode-pty".
export async function dependencyBinary(file: string, label: string) {
  if (!path.isAbsolute(file)) throw new Error(`${label} must be an absolute path: ${file}`)
  const resolved = path.resolve(file)
  let info
  try {
    info = await lstat(resolved)
  } catch (error) {
    if (isMissing(error)) throw new Error(`${label} does not exist: ${resolved}`)
    throw error
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Unsafe ${label}: ${resolved}`)
  assertOwner(info, label)
  return resolved
}

export async function verifiedBinary(file: string, expected: string | undefined) {
  const resolved = await dependencyBinary(file, "persistent PTY binary")
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("A persistent PTY SHA-256 digest is required")
  if ((await lstat(resolved)).nlink !== 1) throw new Error("Unsafe linked persistent PTY binary")
  if (digest(await readFile(resolved)) !== expected)
    throw new Error(`Persistent PTY binary checksum mismatch: ${resolved}`)
  return resolved
}

export function assertOwner(info: Stats, label: string) {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined
  if (uid !== undefined && info.uid !== uid) throw new Error(`${label} is owned by another user`)
}

export function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}