// Exercise the packaged error screen and its real export button on the disposable Windows runner.
import { _electron, expect } from "@playwright/test"
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { appendFile, readFile, readdir, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import path from "node:path"
import { once } from "node:events"

const executablePath = process.argv[2]
if (process.platform !== "win32" || process.env.RUNNER_ENVIRONMENT !== "github-hosted" || !path.isAbsolute(executablePath)) {
  throw new Error("This check requires the installed application on a disposable Windows runner")
}
const logRoot = path.join(process.env.APPDATA, "ai.panacode.desktop", "logs")
const previousRuns = new Set(await readdir(logRoot))
const port = 28844
const listener = createServer((socket) => socket.end())
listener.listen({ host: "127.0.0.1", port, exclusive: true })
await once(listener, "listening")
let desktop
try {
  const start = Date.now()
  desktop = await _electron.launch({ executablePath, args: ["--lang=en-US"], timeout: 60_000 })
  const window = await desktop.firstWindow({ timeout: 60_000 })
  const errorPage = window.locator('[data-panacode-shell="error-page"]')
  const details = errorPage.getByRole("textbox")
  await expect(details).toHaveValue(/(?:already in use|failed to bind|address in use)/i, { timeout: 90_000 })
  await expect(details).toHaveValue(/28844/)
  assert.ok(listener.listening)
  console.log("Installed desktop reported the occupied port in %ds", Math.round((Date.now() - start) / 1000))

  const newRuns = (await readdir(logRoot, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && !previousRuns.has(entry.name),
  )
  assert.equal(newRuns.length, 1, "expected one new desktop log directory")
  const run = path.join(logRoot, newRuns[0].name)
  const marker = "TEST_EXPORT_" + randomUUID()
  await appendFile(path.join(run, "main.log"), marker + "\n")
  await writeFile(path.join(run, "fixture.dmp"), marker)
  const downloads = await desktop.evaluate(({ app }) => app.getPath("downloads"))
  const previousZips = new Set(await readdir(downloads))
  const candidates = async () => (await readdir(downloads)).filter((name) => !previousZips.has(name) && /^panacode-debug-.*\.zip$/.test(name))
  await errorPage.getByRole("button", { name: "Export Logs", exact: true }).click()
  await expect.poll(async () => (await candidates()).length, { timeout: 60_000 }).toBe(1)
  const [archive] = await candidates()
  const bytes = await readFile(path.join(downloads, archive))
  const reader = new ZipReader(new BlobReader(new Blob([bytes])))
  try {
    const entries = await reader.getEntries()
    assert.deepEqual(entries.map((entry) => entry.filename).sort(), ["diagnostics.jsonl", "manifest.json"])
    const members = new Map()
    for (const entry of entries) {
      assert.ok(!entry.directory && entry.getData)
      const text = await entry.getData(new TextWriter())
      assert.ok(!text.includes(marker) && !/https?:\/\/|[a-z]:\\/i.test(text), "archive contained raw information")
      members.set(entry.filename, text)
    }
    const manifest = JSON.parse(members.get("manifest.json"))
    assert.equal(manifest.packaged, true)
    assert.equal(manifest.diagnostics, "included")
    const allowed = new Set(["at", "event", "version", "channel", "stage", "durationMs", "status", "errorCode", "reason"])
    const rows = members.get("diagnostics.jsonl").trim().split("\n").map((line) => JSON.parse(line))
    assert.ok(rows.length > 0 && rows.every((row) => Object.keys(row).every((key) => allowed.has(key))))
    assert.ok(rows.some((row) => row.errorCode === "bind-failed"), "expected a structured port conflict")
  } finally {
    await reader.close()
  }
  console.log("Installed Export Logs returned %d bytes, SHA-256 %s", bytes.length, createHash("sha256").update(bytes).digest("hex"))
} finally {
  try { await desktop?.close() } finally { await new Promise((resolve) => listener.close(resolve)) }
}

// A saved alternate port must recover all the way through renderer IPC and the loading splash.
const cli = path.join(path.dirname(executablePath), "resources", "panacode-cli.exe")
const runCli = (...args) => execFileSync(cli, ["service", ...args], { encoding: "utf8", timeout: 60_000, windowsHide: true })
runCli("set", "port", "28845")
let recovered
try {
  recovered = await _electron.launch({ executablePath, args: ["--lang=en-US"], timeout: 60_000 })
  const window = await recovered.firstWindow({ timeout: 60_000 })
  await expect(window.locator('[data-panacode-shell="window"]')).toBeVisible({ timeout: 120_000 })
  await expect(window.locator('[data-component="startup-overlay"]')).toHaveCount(0, { timeout: 60_000 })
  await expect(window.locator('[data-panacode-shell="error-page"]')).toHaveCount(0)
  let info
  try { info = JSON.parse(runCli("status", "--connection-json")) } catch { throw new Error("Invalid installed CLI status") }
  assert.ok(info.product === "panacode" && info.id && info.pid > 0 && new URL(info.url).port === "28845")
  console.log("The installed desktop showed its main interface and verified its saved alternate port.")
} finally {
  try { await recovered?.close() } finally { runCli("stop") }
}
