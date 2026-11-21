import { chmod, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises"
import path from "node:path"
import { assertOwner, dependencyBinary, digest, isMissing, verifiedBinary, type Asset } from "./binary.js"
import asset from "./pty-binding.js"

export const available = true

/**
 * Resolve the persistent PTY daemon for the current runtime.
 *
 * A packaged build embeds its own asset and installs it into a private cache whose digest must
 * match. A development checkout may use the pinned `@opencode/pty` dependency. `PANACODE_PTY_BIN`
 * is a development/test override: it must be an absolute file and is ignored by packaged builds,
 * so a released executable can never be redirected to another program.
 */
export function resolveBinary(bin?: string) {
  return resolve(bin, asset)
}

export async function resolve(bin: string | undefined, asset: Asset | string | undefined) {
  // A released build runs only the asset it was built with, from its private cache. The runtime
  // override is not consulted here: silently preferring another executable would defeat packaging.
  if (asset !== undefined && typeof asset !== "string") {
    if (!bin) throw new Error("Persistent PTY cache directory is required for an embedded binary")
    return install(bin, asset)
  }
  const override = process.env.PANACODE_PTY_BIN
  if (override) return dependencyBinary(override, "PANACODE_PTY_BIN")
  if (typeof asset === "string") return dependencyBinary(asset, "Persistent PTY dependency binary")
  throw new Error(
    `No persistent PTY binary is available for ${process.platform}-${process.arch}; ` +
      "install the matching @opencode/pty package or set PANACODE_PTY_BIN to an absolute path",
  )
}

async function install(bin: string, input: Asset) {
  const root = path.join(bin, "opencode-pty")
  await privateDirectory(root)
  const directory = path.join(root, `${input.version}-${input.sha256.slice(0, 16)}`)
  await privateDirectory(directory)
  // Windows only launches executables with their extension.
  const destination = path.join(directory, process.platform === "win32" ? "opencode-pty.exe" : "opencode-pty")
  if (await cached(destination, input.sha256)) return destination

  const bytes = new Uint8Array(await Bun.file(input.path).arrayBuffer())
  if (digest(bytes) !== input.sha256) throw new Error("Embedded opencode-pty checksum mismatch")
  const temporary = path.join(directory, `opencode-pty.${process.pid}.${crypto.randomUUID()}.tmp`)
  try {
    const file = await open(temporary, "wx", 0o700)
    try {
      await file.writeFile(bytes)
      await file.sync()
    } finally {
      await file.close()
    }
    await chmod(temporary, 0o755)
    await rename(temporary, destination).catch(async (error) => {
      if (await cached(destination, input.sha256)) return
      // `cached` removed a corrupt destination; one retry can now claim the name.
      await rename(temporary, destination).catch(() => {
        throw error
      })
    })
  } finally {
    await rm(temporary, { force: true })
  }
  const file = await verifiedBinary(destination, input.sha256)
  await chmod(file, 0o755)
  return file
}

async function privateDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsafe opencode-pty directory: ${directory}`)
  assertOwner(info, `opencode-pty directory ${directory}`)
  await chmod(directory, 0o700)
}

// A cache file with the right bytes is reused. A regular file with the wrong bytes never ran from
// this path; replace it from the embedded asset instead of failing forever. A link or a file owned
// by another user is refused, because replacing it cannot be proven safe.
async function cached(file: string, expected: string) {
  let info
  try {
    info = await lstat(file)
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Unsafe opencode-pty executable: ${file}`)
  assertOwner(info, `opencode-pty executable ${file}`)
  if (digest(await readFile(file)) === expected) {
    await chmod(file, 0o755)
    return true
  }
  await rm(file, { force: true })
  return false
}