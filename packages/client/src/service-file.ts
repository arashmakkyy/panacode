import { constants } from "node:fs"
import { copyFile, link, readFile, rename, rm } from "node:fs/promises"
import type { Info } from "./service.js"
import { parseRegistration, same } from "./service-probe.js"

/**
 * Remove a registration file only when it still describes the expected instance.
 *
 * The file is renamed to a private quarantine path first, so a registration written by a newer
 * service between the identity check and the unlink stays live. A quarantined record that belongs
 * to a newer writer is put back without overwriting anything newer.
 */
export async function removeOwned(file: string, expected: Info) {
  const quarantine = `${file}.${crypto.randomUUID()}.delete`
  try {
    await rename(file, quarantine)
  } catch (cause) {
    if (missing(cause)) return false
    throw cause
  }
  const text = await readFile(quarantine, "utf8").catch(() => undefined)
  const found = text === undefined ? undefined : parseRegistration(text).info
  if (found !== undefined && same(found, expected)) {
    await rm(quarantine, { force: true })
    return true
  }
  await restore(quarantine, file)
  await rm(quarantine, { force: true })
  return false
}

async function restore(source: string, destination: string) {
  try {
    await link(source, destination)
    return
  } catch (cause) {
    if (exists(cause)) return
  }
  // Filesystems without hard links still must not overwrite a newer registration.
  await copyFile(source, destination, constants.COPYFILE_EXCL).catch((cause) => {
    if (!exists(cause)) throw cause
  })
}

function missing(cause: unknown) {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT"
}

function exists(cause: unknown) {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EEXIST"
}