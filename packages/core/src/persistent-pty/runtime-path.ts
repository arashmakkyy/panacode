import { createHash } from "node:crypto"
import { constants, lstatSync, mkdtempSync, realpathSync, rmdirSync } from "node:fs"
import { open } from "node:fs/promises"
import path from "node:path"
import { physicalPath, upstreamRoots, within } from "@opencode/util/product-path"
import { privateDirectory } from "@opencode/util/private-directory"

const uid = process.platform === "win32" ? undefined : process.getuid?.()

function checkOwner(info: { uid: number; mode: number }) {
  if (uid !== undefined && (info.uid !== uid || (info.mode & 0o022) !== 0))
    throw new Error("Unsafe PTY runtime ownership")
}

function runtimeRoot(root: string, create = false) {
  const physical = physicalPath(root)
  if (
    physical.toLowerCase().split(path.sep).includes(".opencode") ||
    upstreamRoots().some((entry) => within(entry, physical))
  )
    throw new Error("The terminal runtime belongs to another application")
  const base = privateDirectory(root, create)
  checkOwner(lstatSync(base))
  return base
}

// The native sweeper inspects siblings of its own registration directory. A fresh,
// exclusively allocated parent keeps older registrations outside its scan.
const isSpawnParent = (name: string) => /^spawn-[A-Za-z0-9]{6}$/.test(name)

export function createDaemonRuntime(root: string) {
  const parent = mkdtempSync(path.join(runtimeRoot(root, true), "spawn-"))
  return path.join(root, path.basename(parent), "daemon")
}

export function runtimeDirectory(root: string, directory: string) {
  if (!path.isAbsolute(directory) || directory.split(path.sep).some((part) => part === "." || part === ".."))
    throw new Error("Invalid PTY runtime name")
  const parts = path.relative(path.resolve(root), directory).split(path.sep)
  const direct = parts.length === 1 && parts[0] !== "" && parts[0] !== ".." && !isSpawnParent(parts[0])
  const isolated = parts.length === 2 && isSpawnParent(parts[0]) && parts[1] === "daemon"
  if (!direct && !isolated) throw new Error("PTY directory is outside the managed runtime")
  const base = runtimeRoot(root)
  const target = privateDirectory(path.join(base, ...parts))
  checkOwner(lstatSync(target))
  return target
}

export function removeEmptySpawnParent(root: string, directory: string) {
  const parts = path.relative(root, directory).split(path.sep)
  if (parts.length !== 2 || !isSpawnParent(parts[0]) || parts[1] !== "daemon") return
  try {
    rmdirSync(privateDirectory(path.join(runtimeRoot(root), parts[0])))
  } catch {
    // Native cleanup may still be running. Never delete files to empty the parent.
  }
}

export async function readPtyRegistration(directory: string) {
  const file = path.join(directory, "service.json")
  const before = lstatSync(file)
  if (!before.isFile() || before.nlink !== 1 || before.size > 64 * 1024) throw new Error("Unsafe PTY registration")
  checkOwner(before)
  if (uid !== undefined && (before.mode & 0o077) !== 0) throw new Error("PTY registration exposes its credentials")
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const actual = await handle.stat()
    if (!actual.isFile() || actual.nlink !== 1 || actual.dev !== before.dev || actual.ino !== before.ino)
      throw new Error("PTY registration changed before reading")
    return await handle.readFile("utf8")
  } finally {
    await handle.close()
  }
}

// The Rust daemon adds its own per-user subdirectory. Keep the absolute path short for AF_UNIX.
export function nativeSocketBase() {
  const base = privateDirectory(path.join("/tmp", `panacode-pty-${uid}`), true)
  checkOwner(lstatSync(base))
  return base
}

export function checkDaemonEndpoint(directory: string, socket: string, instance: string) {
  if (process.platform === "win32") {
    if (!/^[a-f0-9]{32}$/.test(instance) || socket !== `\\\\.\\pipe\\opencode-pty-${instance}`)
      throw new Error("PTY named pipe does not match its instance")
    return
  }
  const socketDir = privateDirectory(path.dirname(socket))
  const file = path.join(socketDir, path.basename(socket))
  const info = lstatSync(file)
  if (!info.isSocket() || info.nlink !== 1) throw new Error("Unsafe PTY socket")
  checkOwner(info)
  checkOwner(lstatSync(socketDir))
  // Native 0.5.2 hashes the canonical runtime directory to fit Unix socket path limits.
  // Earlier Panacode installations used the upstream's default short socket root.
  if (!matchesUnixDaemonSocket(directory, file, realpathSync.native("/tmp"), uid))
    throw new Error("PTY socket does not belong to its runtime directory")
}

export function matchesUnixDaemonSocket(directory: string, file: string, temp: string, user: number | undefined) {
  const hash = createHash("sha256").update(directory).digest("hex").slice(0, 32)
  const nativeDir = `opencode-pty-${user}`
  return (
    file === path.posix.join(temp, nativeDir, hash + ".sock") ||
    file === path.posix.join(temp, `panacode-pty-${user}`, nativeDir, hash + ".sock")
  )
}
