/// <reference path="./proper-lockfile.d.ts" />
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { connect } from "node:net"
import { lstat, open, rename, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import lockfile from "proper-lockfile"
import { request } from "./service-control.js"
import type { Info } from "./service.js"
import { localEndpoint, parseRegistration, same } from "./service-probe.js"

// All publishers, conditional removers and terminal-sidecar writers serialize on the same
// pathname, including the interval before the first registration exists. The actual publication
// is still an atomic rename, so readers and the daemon's watcher never see an intermediate file.
export async function withRegistrationLock<T>(file: string, operation: () => Promise<T>) {
  // proper-lockfile tracks held locks by its first argument. Sibling registrations may be
  // locked together during migration, including a destination that does not exist yet.
  const release = await lockfile.lock(resolve(file), {
    realpath: false,
    lockfilePath: resolve(file) + ".mutation-lock",
    retries: { retries: 300, factor: 1.5, minTimeout: 10, maxTimeout: 250, randomize: true },
  })
  try {
    return await operation()
  } finally {
    await release()
  }
}

/** A registration can contain credentials. Refuse non-ordinary, redirected or shared entries
 * before reading them, including an entry replaced between lstat and open. */
export async function privateFileBytes(file: string, maxBytes = Infinity, attempts = 3): Promise<Buffer | undefined> {
  const entry = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error
  })
  if (!entry) return
  const ordinary = (info: typeof entry) =>
    info.isFile() &&
    info.nlink === 1 &&
    (process.platform === "win32" || (info.uid === process.getuid?.() && (info.mode & 0o022) === 0)) &&
    info.size <= maxBytes
  if (!ordinary(entry)) throw new Error("Unsafe local service registration file")
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error
    },
  )
  if (!handle) return
  try {
    const opened = await handle.stat()
    if (opened.ino !== entry.ino || opened.dev !== entry.dev || opened.nlink === 0) {
      if (attempts > 1) return privateFileBytes(file, maxBytes, attempts - 1)
      throw new Error("Local service registration changed while opening")
    }
    if (!ordinary(opened)) throw new Error("Unsafe local service registration file")
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

export function registrationBytes(file: string) {
  return privateFileBytes(file, 64 * 1024)
}

const fingerprint = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
export async function registrationSnapshot(file: string) {
  const bytes = await registrationBytes(file)
  return bytes && fingerprint(bytes)
}

export async function currentOwner(file: string, expected: Info) {
  const bytes = await registrationBytes(file)
  const info = bytes && parseRegistration(bytes.toString("utf8")).info
  return info !== undefined && same(info, expected)
}

export function removeOwned(file: string, expected: Info) {
  return withRegistrationLock(file, async () => {
    if (!(await currentOwner(file, expected))) return false
    await rm(file)
    return true
  })
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

function listening(origin: URL) {
  return new Promise<boolean>((resolve) => {
    const socket = connect(
      Number(origin.port || (origin.protocol === "https:" ? 443 : 80)),
      origin.hostname.replace(/^\[|\]$/g, ""),
    )
    const finish = (result: boolean) => {
      socket.destroy()
      resolve(result)
    }
    socket.once("connect", () => finish(true))
    socket.once("error", (error: NodeJS.ErrnoException) => finish(error.code !== "ECONNREFUSED"))
    socket.setTimeout(1_000, () => finish(true))
  })
}

async function checkPrevious(bytes: Buffer, expected: string | undefined, next: Info) {
  if (!expected || fingerprint(bytes) !== expected) throw new Error("A newer local service registration was published")
  const text = bytes.toString("utf8")
  let previous: unknown
  try {
    previous = JSON.parse(text)
  } catch {
    // Invalid JSON cannot represent a live generation. Archive it before replacing the pointer.
    return
  }
  const refusal = () => new Error("The previous local service registration may still have an owner")
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) throw refusal()
  if ("product" in previous && previous.product !== "panacode") throw refusal()
  const record = parseRegistration(text)
  if (record.info && (await request(record.info, "ping", 2_000)).ok) throw refusal()
  if (
    !("pid" in previous) ||
    typeof previous.pid !== "number" ||
    !Number.isSafeInteger(previous.pid) ||
    previous.pid < 1 ||
    previous.pid > 2_147_483_647 ||
    alive(previous.pid)
  )
    throw refusal()
  const oldUrl = record.info?.url ?? record.url
  const newUrl = localEndpoint(next)
  if (!oldUrl || !newUrl) throw refusal()
  const oldOrigin = new URL(oldUrl)
  // This candidate has already bound its own origin. Occupancy of any other advertised port is
  // independently checked without sending a credential or treating an HTTP timeout as a free port.
  if (oldOrigin.origin !== new URL(newUrl).origin && (await listening(oldOrigin))) throw refusal()
}

export async function renameServiceFile(temporary: string, file: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temporary, file)
      return
    } catch (error) {
      if (
        process.platform !== "win32" ||
        attempt >= 20 ||
        !(error instanceof Error) ||
        !("code" in error) ||
        (error.code !== "EPERM" && error.code !== "EACCES")
      )
        throw error
      await delay(10)
    }
  }
}

export async function publishRegistration(
  file: string,
  encoded: string,
  expected?: string,
  prepareConfig?: () => Promise<unknown>,
) {
  const next = parseRegistration(encoded).info
  if (!next) throw new Error("Invalid local service registration for publication")
  const temporary = file + "." + crypto.randomUUID() + ".tmp"
  await writeFile(temporary, encoded, { mode: 0o600, flag: "wx" })
  try {
    await withRegistrationLock(file, async () => {
      const previous = await registrationBytes(file)
      if (previous) await checkPrevious(previous, expected, next)
      // Only the winning publisher persists its credential, before readers can observe it.
      await prepareConfig?.()
      if (previous) {
        // Leave the live name continuously available while keeping the captured stale bytes
        // private for recovery. No timestamp or file chosen by the previous writer is trusted.
        await writeFile(file + "." + crypto.randomUUID() + ".stale", previous, { flag: "wx", mode: 0o600 })
      }
      await renameServiceFile(temporary, file)
    })
  } finally {
    await rm(temporary, { force: true })
  }
}

/** Publish a copy exclusively after verifying its live legacy generation. Stable lock order also
 * handles concurrent migration attempts between version/channel names. */
export async function migrateOwnedRegistration(legacy: string, file: string, expected: Info, encoded: string) {
  const source = resolve(legacy),
    destination = resolve(file)
  if (source === destination) return
  const [first, second] = source < destination ? [source, destination] : [destination, source]
  await withRegistrationLock(first, () =>
    withRegistrationLock(second, async () => {
      if (
        await lstat(destination).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error
        })
      )
        return
      if (!(await currentOwner(source, expected))) return
      if (!(await request(expected, "ping", 2_000)).ok) return
      const temporary = destination + "." + crypto.randomUUID() + ".tmp"
      try {
        await writeFile(temporary, encoded, { mode: 0o600, flag: "wx" })
        await rename(temporary, destination)
      } finally {
        await rm(temporary, { force: true })
      }
    }),
  )
}
