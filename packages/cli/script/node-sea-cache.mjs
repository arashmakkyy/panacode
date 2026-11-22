// Inlined verbatim in the SEA entry point before native modules, assets or plugins can load.
import __panacodeSeaPath from "node:path"
import * as __panacodeSeaCrypto from "node:crypto"
import * as __panacodeSeaFs from "node:fs"
import * as __panacodeSeaOs from "node:os"

export function installPanacodeSeaAssets(temp, bundle, assets, skip, executables) {
  const path = __panacodeSeaPath
  const { createHash, randomUUID } = __panacodeSeaCrypto
  const { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } =
    __panacodeSeaFs
  const uid = process.getuid?.()
  const root = path.join(realpathSync.native(temp), `panacode-node-${uid ?? "user"}`)
  // TMPDIR is configurable. An upstream product tree cannot become the parent of the cache,
  // including when the temp path is an alias to a relocated OpenCode directory.
  if (
    [temp, path.dirname(root)].some((value) =>
      value
        .toLowerCase()
        .split(path.sep)
        .some((part) => part === "opencode" || part === ".opencode"),
    )
  )
    throw new Error("Refusing a Node asset cache inside OpenCode")
  const home = __panacodeSeaOs.homedir()
  const fallback = [".local/share", ".local/state", ".cache", ".config"].map((base) => path.join(home, base))
  const configured = ["XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME"]
    .map((name) => process.env[name])
    .filter((base) => base && path.isAbsolute(base))
  for (const base of [...configured, ...fallback]) {
    let foreign
    try {
      foreign = realpathSync.native(path.join(base, "opencode"))
    } catch (error) {
      if (["ENOENT", "EACCES", "EPERM", "ELOOP", "ENOTDIR"].includes(error.code)) continue
      throw error
    }
    const relative = path.relative(foreign, root)
    if (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))
      throw new Error("Refusing a Node asset cache inside OpenCode")
  }
  const privateDirectory = (directory) => {
    try {
      mkdirSync(directory, { mode: 0o700 })
    } catch (error) {
      if (error.code !== "EEXIST") throw error
    }
    const info = lstatSync(directory)
    if (!info.isDirectory() || (uid !== undefined && info.uid !== uid))
      throw new Error("Unsafe Node asset cache directory")
    if (uid !== undefined && info.mode & 0o077) throw new Error("Node asset cache directory is not private")
  }
  const safeFile = (file) => {
    const info = lstatSync(file, { throwIfNoEntry: false })
    if (info && (!info.isFile() || info.nlink !== 1 || (uid !== undefined && info.uid !== uid)))
      throw new Error("Unsafe Node asset cache file")
    return info
  }
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex")
  if (!/^[a-z0-9-]+$/i.test(bundle)) throw new Error("Invalid Node asset bundle identifier")
  privateDirectory(root)
  const directory = path.join(root, bundle)
  privateDirectory(directory)
  for (const key of assets.keys()) {
    if (key === skip) continue
    const parts = key.split("/")
    if (parts.some((part) => !/^[a-zA-Z0-9_@.+-]+$/.test(part) || part === "." || part === ".."))
      throw new Error("Invalid Node asset key")
    let parent = directory
    for (const part of parts.slice(0, -1)) {
      parent = path.join(parent, part)
      privateDirectory(parent)
    }
    const bytes = new Uint8Array(assets.get(key))
    const expected = sha(bytes)
    const target = path.join(parent, parts.at(-1))
    const mode = executables.includes(key) ? 0o700 : 0o600
    if (safeFile(target) && sha(readFileSync(target)) === expected) {
      if (uid !== undefined) chmodSync(target, mode)
      continue
    }
    const temporary = path.join(parent, randomUUID() + ".tmp")
    try {
      writeFileSync(temporary, bytes, { flag: "wx", mode })
      try {
        renameSync(temporary, target)
      } catch (error) {
        if (!safeFile(target) || sha(readFileSync(target)) !== expected) throw error
      }
    } finally {
      rmSync(temporary, { force: true })
    }
  }
  return directory
}
