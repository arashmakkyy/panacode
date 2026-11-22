// Drive the installed renderer on the disposable runner. Keep Electron's main process on its normal startup path.
import { chromium, expect } from "@playwright/test"
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js"
import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { once } from "node:events"
import { appendFile, readFile, readdir, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import path from "node:path"

const [executablePath, downloads] = process.argv.slice(2)
if (process.platform !== "win32" || process.env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    !path.isAbsolute(executablePath) || !path.isAbsolute(downloads)) {
  throw new Error("This check requires the installed application on a disposable Windows runner")
}
const logRoot = path.join(process.env.APPDATA, "ai.panacode.desktop", "logs")
const cli = path.join(path.dirname(executablePath), "resources", "panacode-cli.exe")
const runCli = (...args) => execFileSync(cli, ["service", ...args], { encoding: "utf8", timeout: 60_000, windowsHide: true })

async function bounded(action, milliseconds, label) {
  let timer
  try {
    return await Promise.race([action, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out: " + label)), milliseconds)
    })])
  } finally {
    clearTimeout(timer)
  }
}

async function withWindow(scenario, check) {
  const reservation = createServer()
  reservation.listen({ host: "127.0.0.1", port: 0, exclusive: true })
  await once(reservation, "listening")
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  const origin = "http://127.0.0.1:" + port
  const child = spawn(executablePath, ["--lang=en-US", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=" + port], {
    stdio: "ignore",
  })
  const exited = once(child, "exit")
  // An error before spawn/exit is also observed by the main try block below.
  void exited.catch(() => {})
  let browser
  let page
  let checkFailed = false
  console.log("Started installed desktop for %s", scenario)
  try {
    await once(child, "spawn")
    await expect.poll(async () => {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("The launched desktop exited early")
      return fetch(origin + "/json/version", { signal: AbortSignal.timeout(1000) }).then((res) => res.ok).catch(() => false)
    }, { timeout: 35_000, message: "waiting for the installed renderer" }).toBe(true)
    // The runner is disposable, but still verify that the PID holding this port is our direct child before attaching.
    const ps = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    const owner = execFileSync(ps, ["-NoProfile", "-NonInteractive", "-Command",
      "(Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -LocalPort " + port + " -ErrorAction Stop).OwningProcess",
    ], { encoding: "utf8", timeout: 20_000, windowsHide: true })
    assert.equal(Number(owner.trim()), child.pid, "unexpected renderer endpoint owner")
    browser = await chromium.connectOverCDP(origin, { timeout: 15_000 })
    const context = browser.contexts()[0]
    await expect.poll(() => {
      page = context.pages().find((candidate) => candidate.url().startsWith("oc://renderer/"))
      return !!page
    }, { timeout: 30_000, message: "waiting for the packaged renderer page" }).toBe(true)
    page.setDefaultTimeout(15_000)
    console.log("Connected to the installed renderer for %s", scenario)
    await check(page)
  } catch (error) {
    checkFailed = true
    console.error("Installed renderer check failed during %s", scenario)
    throw error
  } finally {
    // Close this application's actual last window. The fixture only terminates its own process if a deadline expires.
    try {
      if (page && !page.isClosed()) await bounded(page.close({ runBeforeUnload: true }), 10_000, "close window")
      if (browser) await bounded(browser.close(), 10_000, "detach renderer")
      if (child.pid && child.exitCode === null && child.signalCode === null) await bounded(exited, 15_000, "desktop exit")
    } catch (cleanupError) {
      if (!checkFailed) throw cleanupError
      console.error("Renderer cleanup also exceeded its deadline during %s", scenario)
    } finally {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        child.kill()
        await bounded(exited, 5000, "fixture process cleanup")
      }
    }
  }
}

async function exportArchive(trigger, markers, requiresConflict) {
  const before = new Set(await readdir(downloads))
  const candidates = async () => (await readdir(downloads)).filter((name) => !before.has(name) && /^panacode-debug-.*\.zip$/.test(name))
  await trigger()
  await expect.poll(async () => (await candidates()).length, { timeout: 45_000, message: "waiting for a fresh support ZIP" }).toBe(1)
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
      assert.ok(markers.every((marker) => !text.includes(marker)) && !/https?:\/\/|[a-z]:\\/i.test(text), "archive contained raw information")
      members.set(entry.filename, text)
    }
    const manifest = JSON.parse(members.get("manifest.json"))
    assert.equal(manifest.packaged, true)
    assert.equal(manifest.diagnostics, "included")
    const allowed = new Set(["at", "event", "version", "channel", "stage", "durationMs", "status", "errorCode", "reason"])
    const rows = members.get("diagnostics.jsonl").trim().split("\n").map((line) => JSON.parse(line))
    assert.ok(rows.length > 0 && rows.every((row) => Object.keys(row).every((key) => allowed.has(key))))
    if (requiresConflict) assert.ok(rows.some((row) => row.errorCode === "bind-failed"), "expected a structured port conflict")
    else assert.ok(rows.some((row) => row.event === "service.ready"), "expected verified startup in the recovery run")
  } finally {
    await reader.close()
  }
  console.log("Installed Export Logs returned %d bytes, SHA-256 %s", bytes.length, createHash("sha256").update(bytes).digest("hex"))
}

async function seedRun(previous, marker) {
  const runs = (await readdir(logRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !previous.has(entry.name))
  assert.equal(runs.length, 1, "expected one new desktop log directory")
  const directory = path.join(logRoot, runs[0].name)
  await appendFile(path.join(directory, "main.log"), marker + "\n")
  await appendFile(path.join(directory, "server.log"), marker + "\n")
  await writeFile(path.join(directory, "fixture.dmp"), marker)
  return directory
}

const marker = "TEST_EXPORT_" + randomUUID()
const linkMarker = "TEST_LINK_" + randomUUID()
let before = new Set(await readdir(logRoot))
const listener = createServer((socket) => socket.destroy())
listener.listen({ host: "127.0.0.1", port: 28844, exclusive: true })
await once(listener, "listening")
try {
  const start = Date.now()
  await withWindow("occupied port", async (page) => {
    const errorPage = page.locator('[data-panacode-shell="error-page"]')
    const details = errorPage.getByRole("textbox")
    await expect(details).toHaveValue(/(?:already in use|failed to bind|address in use)/i, { timeout: 90_000 })
    await expect(details).toHaveValue(/28844/)
    assert.ok(listener.listening)
    console.log("Installed desktop reported the occupied port in %ds", Math.round((Date.now() - start) / 1000))
    await seedRun(before, marker)
    await exportArchive(() => errorPage.getByRole("button", { name: "Export Logs", exact: true }).click(), [marker], true)
  })
} finally {
  await new Promise((resolve) => listener.close(resolve))
}

runCli("set", "port", "28845")
before = new Set(await readdir(logRoot))
try {
  await withWindow("saved alternate port", async (page) => {
    await expect(page.locator('[data-panacode-shell="window"]')).toBeVisible({ timeout: 120_000 })
    await expect(page.locator('[data-component="startup-overlay"]')).toHaveCount(0, { timeout: 60_000 })
    await expect(page.locator('[data-panacode-shell="error-page"]')).toHaveCount(0)
    let info
    try { info = JSON.parse(runCli("status", "--connection-json")) } catch { throw new Error("Invalid installed CLI status") }
    assert.ok(info.product === "panacode" && info.id && info.pid > 0 && new URL(info.url).port === "28845")
    console.log("Installed desktop showed its main window on the saved alternate port")
    const directory = await seedRun(before, marker)
    // Normal second-instance link delivery through the installed executable, without printing the synthetic URL.
    const relay = spawn(executablePath, ["panacode://review-check?token=" + linkMarker + "#" + marker], { stdio: "ignore" })
    const [code] = await bounded(once(relay, "exit"), 10_000, "second-instance deep link")
    assert.equal(code, 0)
    const mainLog = path.join(directory, "main.log")
    await expect.poll(async () => {
      const text = await readFile(mainLog, "utf8")
      return text.includes("deep link received") && text.includes("second-instance")
    }, { timeout: 15_000, message: "waiting for the delivered deep link" }).toBe(true)
    assert.ok(!(await readFile(mainLog, "utf8")).includes(linkMarker), "raw deep link appeared in the main log")
    await page.bringToFront()
    await page.keyboard.press("Control+k")
    const palette = page.locator(".command-palette")
    await palette.locator("input").fill("Export logs")
    await exportArchive(() => palette.getByText("Export logs", { exact: true }).click(), [marker, linkMarker], false)
  })
} finally {
  runCli("stop")
}
