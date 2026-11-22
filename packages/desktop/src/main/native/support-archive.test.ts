import { Service, withEnsureTiming } from "@opencode/client/service"
import { describe, expect, test } from "bun:test"
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  cleanupRunDirectories,
  configureDiagnostics,
  diagnosticErrorCode,
  MAX_DIAGNOSTIC_BYTES,
  recordDiagnostic,
  recordServiceBoot,
  writeSupportArchive,
  type DiagnosticRecord,
} from "./support-archive"

const at = "2026-11-21T10:00:00.000Z"

const markers = {
  auth: "AUTH_MARKER",
  header: "HEADER_MARKER",
  cookie: "COOKIE_MARKER",
  query: "QUERY_MARKER",
  fragment: "FRAGMENT_MARKER",
  prompt: "PROMPT_MARKER",
  home: "HOME_MARKER",
  foreign: "FOREIGN_MARKER",
  dump: "DUMP_MARKER",
  apiKey: "APIKEY_MARKER",
  body: "BODY_MARKER",
  callback: "CALLBACK_MARKER",
} as const

const secrets = Object.values(markers)

async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-support-archive-"))
  const run = path.join(root, "run")
  await fs.mkdir(run, { recursive: true })

  return { root, run }
}

async function archive(run: string, output: string) {
  return writeSupportArchive({
    output,
    run,
    version: "2.3.0",
    channel: "dev",
    packaged: true,
    netLog: "excluded",
  })
}

async function extract(file: string) {
  const reader = new ZipReader(new BlobReader(new Blob([await fs.readFile(file)])))
  const entries = await reader.getEntries()
  const result = new Map<string, string>()

  for (const entry of entries) {
    if (entry.directory) continue

    if (!entry.getData) throw new Error(`zip entry ${entry.filename} has no data`)

    result.set(entry.filename, await entry.getData(new TextWriter()))
  }

  await reader.close()

  return result
}

function lines(value: string) {
  return value
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
}

function expectSafe(value: string) {
  for (const secret of secrets) expect(value).not.toContain(secret)
}

describe("Support archive", () => {
  test.each([
    ["bind", "listen EADDRINUSE: address already in use", "bind-failed"],
    ["foreign listener", "Local service port 28844 is already in use. Ownership check failed.", "bind-failed"],
    ["managed port", "Managed service port 28844 on localhost is already in use by another process.", "bind-failed"],
    ["timeout", "startup timed out after 15000ms", "startup-timeout"],
    ["spawn", "spawn /usr/local/bin/panacode ENOENT", "spawn-failed"],
    ["missing CLI", "The bundled Panacode CLI is missing. Reinstall Panacode to restore it.", "missing-cli"],
    ["exit", "service exited with code 1", "exit"],
    ["unknown", undefined, "unknown"],
  ])("%s failures keep a bounded error code", (_name, reason, code) => {
    expect(diagnosticErrorCode(reason)).toBe(code)
  })

  test("a real failed contender exports the bind cause without its stderr", async () => {
    const { root, run } = await workspace()
    try {
      configureDiagnostics(path.join(run, "diagnostics.jsonl"))
      const command = [process.execPath, "-e", 'console.error("Managed service port 28844 on localhost is already in use by /private/test/path");process.exit(1)']
      await expect(Service.ensure(withEnsureTiming({
        command, file: path.join(root, "service.json"), onDiagnostic: recordServiceBoot,
      }, { pollInterval: 20, spawnDelay: 200, promiseTimeout: 4_000 }))).rejects.toThrow("Server process exited")
      const output = path.join(root, "support.zip")
      await archive(run, output)
      const text = (await extract(output)).get("diagnostics.jsonl") ?? ""
      expect(lines(text)).toContainEqual(expect.objectContaining({ event: "service.boot", stage: "exit", errorCode: "bind-failed" }))
      expect(text).not.toContain("/private/test/path")
      expect(text).not.toContain("EADDRINUSE")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("contains only structured diagnostics and a relative manifest", async () => {
    const { root, run } = await workspace()
    const outside = path.join(root, "outside")
    await fs.mkdir(path.join(run, "nested"), { recursive: true })
    await fs.mkdir(outside, { recursive: true })

    const start = {
      at,
      event: "app.start",
      version: "2.3.0",
      channel: "dev",
      status: "started",
    }

    const boot = { at, event: "service.boot", stage: "spawn", durationMs: 12, status: "waiting" }

    const exit = {
      at,
      event: "service.boot",
      stage: "exit",
      durationMs: 4000,
      status: "failed",
      errorCode: "startup-timeout",
      version: "2.3.0",
      channel: "dev",
    }

    const ready = {
      at,
      event: "service.ready",
      version: "2.3.0",
      channel: "dev",
      status: "ready",
      password: markers.auth,
      headers: { authorization: `Bearer ${markers.header}` },
      cookie: markers.cookie,
      query: markers.query,
      fragment: markers.fragment,
      prompt: markers.prompt,
      home: `C:\\Users\\${markers.home}`,
      foreign: markers.foreign,
      dump: markers.dump,
      apiKey: markers.apiKey,
      body: markers.body,
      callback: markers.callback,
    }

    await fs.writeFile(
      path.join(run, "diagnostics.jsonl"),
      [
        JSON.stringify(start),
        JSON.stringify(boot),
        JSON.stringify(exit),
        JSON.stringify(ready),
        `{"at":"${at}","event":"app.start","note":"${markers.auth}"`,
        `Authorization: Bearer ${markers.header}`,
        `prompt: ${markers.prompt} line one`,
        `prompt: ${markers.prompt} line two`,
        `{"at":"${at}","event":"unknown","version":"${markers.foreign}"}`,
      ].join("\n") + "\n",
    )

    await fs.writeFile(
      path.join(run, "main.log"),
      [
        `Authorization: Bearer ${markers.header}`,
        `Cookie: ${markers.cookie}`,
        `prompt=${markers.prompt}`,
        `callback=${markers.callback}`,
        `path=C:\\Users\\${markers.home}`,
      ].join("\n"),
    )
    await fs.utimes(path.join(run, "main.log"), new Date(0), new Date(0))
    await fs.writeFile(path.join(run, "safe-name.log"), `${markers.apiKey}\n${markers.body}\n`)
    await fs.writeFile(path.join(run, "dump.dmp"), Buffer.from(`${markers.dump}\n${markers.foreign}`))
    await fs.writeFile(path.join(run, "network.netlog"), `${markers.query}\n${markers.fragment}`)
    await fs.writeFile(path.join(run, "nested", "other.log"), markers.prompt)
    await fs.writeFile(path.join(outside, "diagnostics.jsonl"), `{"at":"${at}","event":"service.ready","version":"${markers.foreign}"}\n`)
    await fs.symlink(outside, path.join(run, "foreign"), process.platform === "win32" ? "junction" : "dir")

    const output = path.join(root, "out.zip")
    await archive(run, output)
    const entries = await extract(output)

    expect([...entries.keys()].sort()).toEqual(["diagnostics.jsonl", "manifest.json"])

    for (const [name, data] of entries) {
      expectSafe(name)
      expectSafe(data)
      expect(data).not.toContain(root)
    }

    const manifest = JSON.parse(entries.get("manifest.json") ?? "{}")

    expect(manifest).toMatchObject({
      format: 1,
      version: "2.3.0",
      channel: "dev",
      packaged: true,
      platform: process.platform,
      arch: process.arch,
      redaction: "structured-only",
      netLog: "excluded",
      diagnostics: "included",
    })
    expect(manifest.members).toEqual([
      expect.objectContaining({
        name: "diagnostics.jsonl",
        records: 4,
        dropped: 5,
        truncated: false,
        redaction: "structured",
      }),
    ])

    const records = lines(entries.get("diagnostics.jsonl") ?? "")
    const allowed = new Set(["at", "event", "version", "channel", "stage", "durationMs", "status", "errorCode", "reason"])

    for (const record of records) {
      for (const key of Object.keys(record)) expect(allowed.has(key)).toBeTrue()
    }

    expect(records).toContainEqual(
      expect.objectContaining({
        event: "service.boot",
        stage: "exit",
        durationMs: 4000,
        status: "failed",
        errorCode: "startup-timeout",
        version: "2.3.0",
        channel: "dev",
      }),
    )
    expect(records).toContainEqual(expect.objectContaining({ event: "app.start", status: "started" }))
  })

  test("drops a partial tail record and keeps the safe records after it", async () => {
    const { root, run } = await workspace()

    const valid = {
      at,
      event: "service.ready",
      version: "2.3.0",
      channel: "dev",
      status: "ready",
    }

    const huge = Buffer.alloc(MAX_DIAGNOSTIC_BYTES + 1024, 0x78)
    huge.write(markers.auth, huge.length - markers.auth.length - 1)

    await fs.writeFile(
      path.join(run, "diagnostics.jsonl"),
      Buffer.concat([huge, Buffer.from("\n"), Buffer.from(`${JSON.stringify(valid)}\n`)]),
    )

    const output = path.join(root, "out.zip")
    await archive(run, output)
    const entries = await extract(output)
    const diagnostics = entries.get("diagnostics.jsonl") ?? ""

    expectSafe(diagnostics)
    expect(lines(diagnostics)).toEqual([valid])
    expect(JSON.parse(entries.get("manifest.json") ?? "{}").members[0]).toMatchObject({
      name: "diagnostics.jsonl",
      records: 1,
      truncated: true,
    })
  })

  test("a linked diagnostics file, a hard link and an aliased run directory are blocked", async () => {
    const { root, run } = await workspace()
    const outside = path.join(root, "outside")
    await fs.mkdir(outside, { recursive: true })
    const foreign = path.join(outside, "diagnostics.jsonl")
    const valid = { at, event: "service.ready", version: "2.3.0", channel: "dev", status: "ready" }
    await fs.writeFile(foreign, `${JSON.stringify(valid)}\n${markers.auth}\n`)

    const linked = path.join(run, "diagnostics.jsonl")
    let linkedFile = true

    try {
      await fs.symlink(foreign, linked, "file")
    } catch (error) {
      if (!(error instanceof Error) || !isLinkUnsupported(error)) throw error

      linkedFile = false
    }

    if (linkedFile) {
      const output = path.join(root, "linked.zip")
      await archive(run, output)
      const entries = await extract(output)
      expect(JSON.parse(entries.get("manifest.json") ?? "{}").diagnostics).toBe("blocked")
      expect(entries.has("diagnostics.jsonl")).toBeFalse()

      for (const [name, data] of entries) {
        expectSafe(name)
        expectSafe(data)
      }
    }

    await fs.rm(linked, { force: true })

    let hardLinked = true

    try {
      await fs.link(foreign, linked)
    } catch (error) {
      if (!(error instanceof Error) || !isLinkUnsupported(error)) throw error

      hardLinked = false
    }

    if (hardLinked) {
      const output = path.join(root, "hard-link.zip")
      await archive(run, output)
      const entries = await extract(output)
      expect(JSON.parse(entries.get("manifest.json") ?? "{}").diagnostics).toBe("blocked")
      expect(entries.has("diagnostics.jsonl")).toBeFalse()

      for (const [name, data] of entries) {
        expectSafe(name)
        expectSafe(data)
      }
    }

    const target = path.join(root, "target")
    await fs.mkdir(target)
    await fs.writeFile(path.join(target, "diagnostics.jsonl"), `${JSON.stringify(valid)}\n${markers.foreign}\n`)
    const alias = path.join(root, "alias")
    await fs.symlink(target, alias, process.platform === "win32" ? "junction" : "dir")

    const output = path.join(root, "alias.zip")
    await archive(alias, output)
    const entries = await extract(output)
    expect(JSON.parse(entries.get("manifest.json") ?? "{}").diagnostics).toBe("blocked")

    for (const [name, data] of entries) {
      expectSafe(name)
      expectSafe(data)
    }
  })

  test("cleanup removes only old run directories and never follows a link", async () => {
    const { root } = await workspace()
    const logs = path.join(root, "logs")
    const old = path.join(logs, "20200101T000000")
    const recent = path.join(logs, "20260101T000000")
    const foreign = path.join(root, "foreign")
    const foreignRun = path.join(foreign, "keep.txt")
    const aliasTarget = path.join(root, "alias-target")
    const aliasOld = path.join(aliasTarget, "20200101T000000")
    await fs.mkdir(old, { recursive: true })
    await fs.mkdir(recent, { recursive: true })
    await fs.mkdir(foreign, { recursive: true })
    await fs.mkdir(aliasOld, { recursive: true })
    await fs.writeFile(path.join(old, ".panacode-log-run"), "panacode-log-v1\n")
    await fs.writeFile(path.join(old, "main.log"), markers.prompt)
    await fs.writeFile(path.join(recent, "main.log"), markers.body)
    await fs.writeFile(foreignRun, markers.foreign)
    await fs.writeFile(path.join(aliasOld, "keep.txt"), markers.home)
    await fs.writeFile(path.join(logs, "not-a-run"), markers.dump)
    await fs.utimes(old, new Date(0), new Date(0))
    await fs.utimes(aliasOld, new Date(0), new Date(0))
    await fs.symlink(foreign, path.join(logs, "20200202T000000"), process.platform === "win32" ? "junction" : "dir")

    const unowned = path.join(logs, "20200203T000000")
    await fs.mkdir(unowned)
    await fs.writeFile(path.join(unowned, "keep"), "foreign")
    await fs.utimes(unowned, new Date(0), new Date(0))
    await cleanupRunDirectories(logs)
    expect(await fs.readFile(path.join(unowned, "keep"), "utf8")).toBe("foreign")

    expect(await exists(old)).toBeFalse()
    expect(await exists(recent)).toBeTrue()
    expect(await fs.readFile(foreignRun, "utf8")).toBe(markers.foreign)
    expect(await exists(path.join(aliasOld, "keep.txt"))).toBeTrue()
    expect(await exists(path.join(logs, "not-a-run"))).toBeTrue()

    const alias = path.join(root, "alias")
    await fs.symlink(aliasTarget, alias, process.platform === "win32" ? "junction" : "dir")
    await cleanupRunDirectories(alias)
    expect(await exists(path.join(aliasOld, "keep.txt"))).toBeTrue()
  })

  test("a failed write leaves no temporary archive behind", async () => {
    const { root, run } = await workspace()
    const parent = path.join(root, "downloads")
    const output = path.join(parent, "out.zip")
    await fs.mkdir(output, { recursive: true })

    await expect(archive(run, output)).rejects.toThrow()
    expect(await fs.readdir(parent)).toEqual(["out.zip"])
  })

  test("the diagnostic writer stores only allowlisted fields and refuses a link", async () => {
    const { root, run } = await workspace()
    const file = path.join(run, "diagnostics.jsonl")
    configureDiagnostics(file)

    const record = {
      event: "service.boot",
      stage: "exit",
      durationMs: 7,
      status: "failed",
      errorCode: "bind-failed",
      version: "2.3.0",
      channel: "dev",
      password: markers.auth,
      headers: `Bearer ${markers.header}`,
      prompt: markers.prompt,
    }

    // SAFETY: the extra fields are deliberate bait; the allowlisted fields satisfy DiagnosticRecord.
    recordDiagnostic(record as DiagnosticRecord)

    const written = await fs.readFile(file, "utf8")
    expectSafe(written)

    const [stored] = lines(written)

    expect(Object.keys(stored).sort()).toEqual(
      ["at", "channel", "durationMs", "errorCode", "event", "stage", "status", "version"].sort(),
    )
    expect(stored).toMatchObject({ event: "service.boot", errorCode: "bind-failed", durationMs: 7 })

    const foreign = path.join(root, "foreign-diagnostics.jsonl")
    await fs.writeFile(foreign, markers.foreign)
    await fs.rm(file)

    await fs.link(foreign, file)
    recordDiagnostic({ event: "app.error", errorCode: "unknown" })
    expect(await fs.readFile(foreign, "utf8")).toBe(markers.foreign)
    await fs.rm(file)

    try {
      await fs.symlink(foreign, file, "file")
    } catch (error) {
      if (!(error instanceof Error) || !isLinkUnsupported(error)) throw error

      return
    }

    recordDiagnostic({ event: "app.error", errorCode: "unknown", status: "failed" })
    expect(await fs.readFile(foreign, "utf8")).toBe(markers.foreign)
  })
})

async function exists(file: string) {
  return fs
    .lstat(file)
    .then(() => true)
    .catch(() => false)
}

function isLinkUnsupported(error: Error) {
  if (!("code" in error)) return false

  return error.code === "EPERM" || error.code === "EXDEV" || error.code === "ENOTSUP" || error.code === "EOPNOTSUPP"
}