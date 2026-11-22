import type { EnsureDiagnostic } from "@opencode/client/service"
import { randomUUID } from "node:crypto"
import { privateDirectory } from "@opencode/util/private-directory"
import { closeSync, constants, fstatSync, lstatSync, openSync, writeSync } from "node:fs"
import { lstat, mkdtemp, open, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { Option, Schema } from "effect"

/** The only member besides the manifest. Raw logs, dumps and NetLog never enter the archive. */
export const DIAGNOSTICS_MEMBER = "diagnostics.jsonl"

/** A support archive is diagnostics, not a copy of the log directory. */
export const MAX_DIAGNOSTIC_BYTES = 5 * 1024 * 1024

const RUN_DIRECTORY = /^\d{8}T\d{6}(?:-[a-zA-Z0-9]{6})?$/u
const RUN_MARKER = ".panacode-log-run"

export async function createRunDirectory(root: string, stamp: string) {
  const directory = await mkdtemp(path.join(privateDirectory(root, true), stamp + "-"))
  await writeFile(path.join(directory, RUN_MARKER), "panacode-log-v1\n", { flag: "wx", mode: 0o600 })
  return directory
}

const VERSION = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/u))

const Diagnostic = Schema.Struct({
  at: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)),
  event: Schema.Literals(["app.start", "app.error", "service.start", "service.boot", "service.ready", "service.error"]),
  version: Schema.optional(VERSION),
  channel: Schema.optional(Schema.Literals(["local", "dev", "beta", "prod"])),
  stage: Schema.optional(Schema.Literals(["spawn", "register", "health", "exit", "ready"])),
  durationMs: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))),
  status: Schema.optional(Schema.Literals(["started", "waiting", "ready", "failed"])),
  errorCode: Schema.optional(
    Schema.Literals(["startup-timeout", "bind-failed", "spawn-failed", "exit", "missing-cli", "unknown"]),
  ),
  reason: Schema.optional(Schema.Literals(["missing", "version-mismatch"])),
})

export type DiagnosticRecord = Omit<typeof Diagnostic.Type, "at">

export type DiagnosticErrorCode = NonNullable<typeof Diagnostic.Type.errorCode>

const decodeDiagnostic = Schema.decodeUnknownOption(Schema.fromJsonString(Diagnostic))

let diagnosticsFile: string | undefined

/** Writes only records created by this module, never arbitrary lines from the application. */
export function configureDiagnostics(file: string) {
  diagnosticsFile = file
}

export function recordDiagnostic(record: DiagnosticRecord) {
  if (!diagnosticsFile) return

  let fd: number | undefined
  try {
    privateDirectory(path.dirname(diagnosticsFile))
    const previous = lstatSync(diagnosticsFile, { throwIfNoEntry: false })
    if (previous && (!previous.isFile() || previous.nlink !== 1)) return
    fd = openSync(diagnosticsFile, constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0) |
      (previous ? 0 : constants.O_CREAT | constants.O_EXCL), 0o600)
    const info = fstatSync(fd)
    if (!info.isFile() || info.nlink !== 1 || (previous && !sameIdentity(previous, info))) return
    writeSync(fd, JSON.stringify(toDiagnostic(record)) + "\n")
  } catch {
    // A linked, missing or inaccessible log must not interrupt application work.
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export function recordServiceBoot(diagnostic: EnsureDiagnostic) {
  recordDiagnostic({
    event: "service.boot",
    stage: diagnostic.stage,
    durationMs: diagnostic.elapsed,
    status: diagnostic.state,
    errorCode: diagnostic.stage === "exit" ? diagnostic.errorCode ?? diagnosticErrorCode(diagnostic.reason) : undefined,
  })
}

function toDiagnostic(record: DiagnosticRecord) {
  return Schema.decodeUnknownSync(Diagnostic)({ at: new Date().toISOString(), ...record })
}

/** Classifies a startup failure without storing the message, which may contain any private text. */
export function diagnosticErrorCode(reason: string | undefined): DiagnosticErrorCode {
  const value = reason?.toLowerCase() ?? ""

  if (/eaddrinuse|address already in use|service port [^\n]*already in use|failed to bind|cannot bind/.test(value)) return "bind-failed"

  if (/timed out|timeout|deadline/.test(value)) return "startup-timeout"

  if (/enoent|not found|spawn/.test(value)) return "spawn-failed"

  if (/missing|not bundled/.test(value)) return "missing-cli"

  if (reason) return "exit"

  return "unknown"
}

export type SupportArchiveOptions = {
  readonly output: string
  readonly run: string
  readonly version: string
  readonly channel: string
  readonly packaged: boolean
  readonly netLog: "excluded" | "not-running"
}

/**
 * Writes a support ZIP that contains the current run's allowlisted diagnostic records and a manifest. It never walks
 * the log tree, so a file that happens to sit beside the diagnostics is not a member, whatever its name says.
 */
export async function writeSupportArchive(options: SupportArchiveOptions) {
  const diagnostics = await readDiagnostics(options.run).catch(() => ({ status: "blocked" as const }))
  const members = diagnostics.status === "included" ? [diagnostics.member] : []

  const manifest = {
    format: 1,
    generated: new Date().toISOString(),
    version: options.version,
    channel: options.channel,
    packaged: options.packaged,
    platform: process.platform,
    arch: process.arch,
    redaction: "structured-only",
    netLog: options.netLog,
    diagnostics: diagnostics.status,
    members,
  }

  const entries = [
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) },
    ...(diagnostics.status === "included" ? [{ name: DIAGNOSTICS_MEMBER, data: diagnostics.data }] : []),
  ]

  await writeZip(options.output, entries)

  return { output: options.output, diagnostics: diagnostics.status, members: entries.map((entry) => entry.name) }
}

/** Removes only this app's old run directories, and never follows a link out of the log root. */
export async function cleanupRunDirectories(directory: string) {
  const root = await ownedDirectory(directory).catch(() => undefined)

  if (!root) return

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    if (!RUN_DIRECTORY.test(entry.name)) continue
    const target = path.join(root, entry.name)
    const info = await lstat(target).catch(() => undefined)

    if (!info || !info.isDirectory() || info.isSymbolicLink() || info.mtimeMs >= cutoff) continue

    const marker = path.join(target, RUN_MARKER)
    const receipt = await lstat(marker).catch(() => undefined)
    if (!receipt?.isFile() || receipt.nlink !== 1 || receipt.size !== 16 ||
        await readFile(marker, "utf8").catch(() => "") !== "panacode-log-v1\n") continue
    await rm(target, { recursive: true, force: true }).catch(() => {})
  }
}

type DiagnosticMember = {
  readonly name: typeof DIAGNOSTICS_MEMBER
  readonly bytes: number
  readonly records: number
  readonly dropped: number
  readonly truncated: boolean
  readonly redaction: "structured"
}

async function readDiagnostics(directory: string): Promise<
  | { readonly status: "included"; readonly data: Uint8Array; readonly member: DiagnosticMember }
  | { readonly status: "missing" }
> {
  const root = await ownedDirectory(directory)

  if (!root) return { status: "missing" }

  const file = path.join(root, DIAGNOSTICS_MEMBER)

  const first = await lstat(file).catch((error: Error) => {
    if (isMissing(error)) return undefined
    throw error
  })

  if (!first) return { status: "missing" }

  if (!first.isFile() || first.isSymbolicLink() || first.nlink > 1) throw new Error("Diagnostics is not an owned file")

  const resolved = await realpath(file)

  if (!within(root, resolved)) throw new Error("Diagnostics escapes its run directory")

  const handle = await open(file, "r")
  const chunks: Buffer[] = []
  let truncated = false
  let records = 0
  let dropped = 0

  try {
    const opened = await handle.stat()

    if (!sameIdentity(first, opened)) throw new Error("Diagnostics changed before it was read")

    const size = Number(opened.size)
    const start = Math.max(0, size - MAX_DIAGNOSTIC_BYTES)
    truncated = start > 0
    const buffer = Buffer.alloc(size - start)

    let read = 0

    while (read < buffer.length) {
      const result = await handle.read(buffer, read, buffer.length - read, start + read)

      if (result.bytesRead === 0) break

      read += result.bytesRead
    }

    const lines = buffer.subarray(0, read).toString("utf8").split("\n")

    // A tail can begin inside a record and a crash can leave a record without its newline.
    if (truncated) lines.shift()

    if (read > 0 && buffer[read - 1] !== 0x0a) lines.pop()

    for (const line of lines) {
      if (!line.trim()) continue

      const decoded = decodeDiagnostic(line)

      if (Option.isNone(decoded)) {
        dropped++
        continue
      }

      records++
      chunks.push(Buffer.from(`${JSON.stringify(decoded.value)}\n`))
    }
  } finally {
    await handle.close()
  }

  const data = Buffer.concat(chunks)

  return {
    status: "included",
    data,
    member: {
      name: DIAGNOSTICS_MEMBER,
      bytes: data.byteLength,
      records,
      dropped,
      truncated,
      redaction: "structured",
    },
  }
}

async function ownedDirectory(directory: string) {
  try { return privateDirectory(directory) } catch (error) {
    if (error instanceof Error && isMissing(error)) return undefined
    throw error
  }
}

function sameIdentity(first: Awaited<ReturnType<typeof lstat>>, second: Awaited<ReturnType<typeof lstat>>) {
  return String(first.dev) === String(second.dev) && String(first.ino) === String(second.ino)
}

function within(root: string, file: string) {
  const relative = path.relative(root, file)

  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)
}

function isMissing(error: Error) {
  return "code" in error && error.code === "ENOENT"
}

async function writeZip(output: string, entries: { name: string; data: Uint8Array }[]) {
  const temp = `${output}.${process.pid}.${randomUUID()}.tmp`

  try {
    const { BlobReader, BlobWriter, ZipWriter } = await import("@zip.js/zip.js")
    // macOS Archive Utility and ditto reject bit-3 data descriptors without the PK\x07\x08 signature.
    const writer = new ZipWriter(new BlobWriter("application/zip"), { dataDescriptorSignature: true })

    for (const entry of entries) {
      await writer.add(entry.name, new BlobReader(new Blob([new Uint8Array(entry.data)])))
    }

    const zip = await writer.close()
    await writeFile(temp, new Uint8Array(await zip.arrayBuffer()), { mode: 0o600 })
    await rename(temp, output)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
}