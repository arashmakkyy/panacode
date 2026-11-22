import { lstatSync, mkdirSync, realpathSync } from "node:fs"
import path from "node:path"

// Check each component before creating or using its child. macOS supplies these
// system aliases even for ordinary temporary directories under /var/folders.
export function privateDirectory(directory: string, create = false) {
  if (!path.isAbsolute(directory)) throw new Error("Expected an absolute directory")
  if (process.platform === "win32" && !/^[A-Za-z]:[\\/]/.test(directory))
    throw new Error("Expected a private directory on a local Windows drive")
  const absolute = path.resolve(directory)
  const root = path.parse(absolute).root
  let current = root
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    if (
      process.platform === "darwin" &&
      ["/var", "/tmp", "/etc"].includes(current) &&
      realpathSync(current) === "/private" + current
    ) {
      current = realpathSync(current)
      continue
    }
    if (create && !lstatSync(current, { throwIfNoEntry: false })) {
      try {
        mkdirSync(current, { mode: 0o700 })
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
      }
    }
    const info = lstatSync(current)
    const actual = realpathSync.native(current)
    // Runners and legitimate Windows profiles can use an 8.3 spelling of the same directory.
    const shortName =
      process.platform === "win32" &&
      /~[0-9]/.test(part) &&
      path.relative(path.dirname(current), path.dirname(actual)) === "" &&
      info.ino !== 0 &&
      info.ino === lstatSync(actual).ino
    if (!info.isDirectory() || info.isSymbolicLink() || (!shortName && path.relative(current, actual) !== ""))
      throw new Error("Expected an ordinary directory without redirected components")
    current = actual
  }
  if (process.getuid && process.platform !== "win32") {
    const directoryInfo = lstatSync(current)
    if (directoryInfo.uid !== process.getuid() || (directoryInfo.mode & 0o022) !== 0)
      throw new Error("Expected a directory owned by the current user with exclusive write access")
  }
  return current
}
