import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createHash, randomUUID } from "node:crypto"
import { createReadStream, constants } from "node:fs"
import { chmod, copyFile, lstat, readFile, rename, rm } from "node:fs/promises"
import path from "node:path"
import { privateDirectory } from "@opencode/util/private-directory"
import { stageName } from "./cli-version"

async function regular(file: string) {
  const stat = await lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
    throw new Error("The bundled Panacode CLI requires an ordinary private file.")
}

export async function fileDigest(file: string) {
  await regular(file)
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("hex")
}

export async function packagedIdentity(source: string) {
  const file = source + ".provenance.json"
  await regular(file)
  const record = JSON.parse(await readFile(file, "utf8"))
  const target = (process.platform === "win32" ? "windows" : process.platform) + "-" + process.arch
  const suffix = process.arch === "x64" ? "-baseline" : ""
  if (
    record?.target !== target ||
    record.package !== "@panacode/cli-" + target + suffix ||
    typeof record.version !== "string" ||
    !/^[\w.+-]{1,96}$/.test(record.version) ||
    typeof record.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.sha256)
  )
    throw new Error("The bundled Panacode CLI build metadata is invalid. Reinstall Panacode.")
  const version: string = record.version
  const digest: string = record.sha256
  if (process.platform === "darwin") {
    // The Developer ID signing pass can replace the ad-hoc Mach-O signature after
    // afterPack. The final app signature seals both the resource and its metadata.
    const signedDigest = await fileDigest(source)
    if (signedDigest !== digest) {
      const bundle = path.resolve(path.dirname(source), "../..")
      if (!bundle.endsWith(".app")) throw new Error("The bundled Panacode CLI is outside the app bundle.")
      await promisify(execFile)("/usr/bin/codesign", ["--verify", "--strict", "--deep", bundle], { timeout: 60000 })
      return { version, digest: signedDigest }
    }
  }
  return { version, digest }
}

export async function stageCli(source: string, userData: string, name: string, version: string, digest: string) {
  const stage = stageName(version) + "-" + digest
  const root = privateDirectory(path.join(privateDirectory(userData, true), "cli"), true)
  const directory = privateDirectory(path.join(root, stage), true)
  const destination = path.join(directory, name)
  const current = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error
  })
  if (current && (await fileDigest(destination)) === digest) return destination
  await regular(source)
  const temp = path.join(directory, "." + randomUUID() + ".tmp")
  try {
    await copyFile(source, temp, constants.COPYFILE_EXCL)
    if ((await fileDigest(temp)) !== digest) throw new Error("The bundled Panacode CLI failed its integrity check.")
    if (process.platform !== "win32") await chmod(temp, 0o700)
    await rename(temp, destination).catch(async (error) => {
      if ((await fileDigest(destination)) !== digest) throw error
    })
    return destination
  } finally {
    await rm(temp, { force: true })
  }
}
