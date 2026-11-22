export * as PtyHandoff from "./pty-handoff.js"

import type { PersistentPty } from "@opencode/schema/persistent-pty"
import { rename, rm, writeFile } from "node:fs/promises"
import type { Info } from "./service.js"
import { currentOwner, registrationBytes, withRegistrationLock } from "./service-file.js"
import { parseRegistration } from "./service-probe.js"
import { request } from "./service-control.js"

type Sidecar = {
  readonly source: Pick<Info, "id" | "pid" | "url">
  readonly handoff: PersistentPty.Handoff | null
  readonly expiresAt: number
}

/**
 * Publish the ticket before stopping its owner so every replacement contender can adopt it.
 * A confirmed terminal shutdown permits replacement without a handoff when preparation is unavailable.
 */
export async function prepare(file: string, info: Info, timeout: number) {
  const existing = await read(file)
  if (existing !== undefined && existing.expiresAt > Date.now() && same(existing.source, info)) return
  const result = await request(info, "pty-handoff", timeout)
  let handoff: PersistentPty.Handoff | null
  if (result.ok) {
    handoff = parse({ handoff: result.value })
  } else {
    // The authenticated owner's terminal subsystem can be unavailable. Never send a secondary
    // command or any Basic credential to its old HTTP port.
    const concurrent = await read(file)
    if (concurrent && concurrent.expiresAt > Date.now() && same(concurrent.source, info)) return
    const stopped = await request(info, "pty-shutdown", timeout)
    if (!stopped.ok) throw new Error(stopped.message)
    handoff = null
  }
  await publish(file, info, handoff)
}

function parse(body: unknown) {
  if (typeof body !== "object" || body === null || !("handoff" in body))
    throw new Error("Invalid persistent terminal handoff response")
  if (body.handoff === null) return null
  if (!isHandoff(body.handoff) || body.handoff.expiresAt <= Date.now())
    throw new Error("Invalid or expired persistent terminal handoff")
  return body.handoff
}

async function publish(file: string, info: Info, handoff: PersistentPty.Handoff | null) {
  const temporary = `${file}.pty-handoff.${crypto.randomUUID()}.tmp`
  await writeFile(
    temporary,
    JSON.stringify({
      source: { id: info.id, pid: info.pid, url: info.url },
      handoff,
      expiresAt: handoff?.expiresAt ?? Date.now() + 30_000,
    } satisfies Sidecar),
    { mode: 0o600, flag: "wx" },
  )
  await rename(temporary, file + ".pty-handoff").finally(() => rm(temporary, { force: true }))
}

export async function environment(file: string, env?: Readonly<Record<string, string>>) {
  const record = await read(file)
  const registration = await registrationBytes(file)
  const current = registration && parseRegistration(registration.toString("utf8")).info
  const handoff =
    record && record.expiresAt > Date.now() && (!registration || (current && same(record.source, current)))
      ? record.handoff
      : undefined
  return { ...env, PANACODE_PTY_HANDOFF: handoff == null ? undefined : JSON.stringify(handoff) }
}

export async function complete(file: string, info: Info) {
  return withRegistrationLock(file, async () => {
    if (!(await currentOwner(file, info))) return false
    const record = await read(file)
    if (record !== undefined && !same(record.source, info)) await clear(file)
    return true
  })
}

export async function clear(file: string) {
  if (await read(file)) await rm(file + ".pty-handoff", { force: true })
}

async function read(file: string): Promise<Sidecar | undefined> {
  const bytes = await registrationBytes(file + ".pty-handoff")
  if (!bytes) return
  let value: unknown
  try {
    value = JSON.parse(bytes.toString("utf8"))
  } catch {
    return
  }
  if (typeof value !== "object" || value === null || !("source" in value) || !("handoff" in value)) return
  if (typeof value.source !== "object" || value.source === null) return
  if (!("pid" in value.source) || typeof value.source.pid !== "number") return
  if (!("url" in value.source) || typeof value.source.url !== "string") return
  if ("id" in value.source && typeof value.source.id !== "string") return
  if (value.handoff !== null && !isHandoff(value.handoff)) return
  if (!("expiresAt" in value) || typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt)) return
  return {
    source: {
      id: "id" in value.source && typeof value.source.id === "string" ? value.source.id : undefined,
      pid: value.source.pid,
      url: value.source.url,
    },
    handoff: value.handoff,
    expiresAt: value.expiresAt,
  }
}

function same(left: Sidecar["source"], right: Info) {
  return left.id === right.id && left.pid === right.pid && left.url === right.url
}

function isHandoff(value: unknown): value is PersistentPty.Handoff {
  return (
    typeof value === "object" &&
    value !== null &&
    "directory" in value &&
    typeof value.directory === "string" &&
    "instanceID" in value &&
    typeof value.instanceID === "string" &&
    "ticket" in value &&
    typeof value.ticket === "string" &&
    "expiresAt" in value &&
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt)
  )
}
