// Replay the reported responses through the shipped CLI, real PanaAI protocol, session and file tools.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { chromium } from "@playwright/test"

const [bin, ...entry] = process.argv.slice(2)
assert.ok(bin && path.isAbsolute(bin), "supply the installed CLI or an absolute source runner")
const home = await mkdtemp(path.join(os.tmpdir(), "panacode-tools-"))
const project = path.join(home, "پروژه آزمایشی (3)")
const other = path.join(home, "other-project")
await Promise.all([mkdir(project), mkdir(other)])
const model = "deepseek-v4.1-flash-1017-abliterated"
const prompt = "یک لندینگ فارسی برای فروش API بساز و دکمهٔ شروع را قابل استفاده کن."
const files = {
  "index.html": '<!DOCTYPE html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>فروش API</title><link rel="stylesheet" href="site.css"><main><h1>فروش API هوش مصنوعی</h1><button>شروع</button><output></output></main><script src="app.js"></script></html>',
  "site.css": "main{max-width:48rem;margin:auto}button{cursor:pointer}",
  "app.js": 'document.querySelector("button").onclick=()=>{document.querySelector("output").textContent="آماده"}',
}
const names = Object.keys(files)
const title = "آزمون کامل شد"
const invalid = '{"path":"partial.html","content":"'.padEnd(23_859, "م")
const oversized = "REJECTED_BODY_".repeat(2000)
const packet = (calls, text = null) => ({
  id: "fixture-completion", object: "chat.completion", model,
  choices: [{ index: 0, message: { role: "assistant", content: text, ...(calls.length ? { tool_calls: calls } : {}) },
    finish_reason: calls.length ? "tool_calls" : "stop" }],
})
const call = (id, name, args) => ({ id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } })
let rounds = 0
let powerShell = false
let summarized = false
let recovered = false
let failure
function completion(body) {
  assert.equal(body.stream, false, "the replay must use the production PanaAI protocol")
  assert.equal(body.model, model)
  const history = JSON.stringify(body.messages)
  // The product can request a session title concurrently with the work. It uses a separate, tool-free call.
  if (!body.tools?.length && body.messages.some((m) => m.role === "system" &&
    typeof m.content === "string" && m.content.startsWith("You name conversations"))) return packet([], "لندینگ فارسی")
  const turn = rounds++
  if (turn === 0) {
    assert.ok(history.includes(prompt))
    assert.ok(body.tools.some((t) => t.function?.name === "write"))
    const shell = body.tools.find((t) => t.function?.name === "shell")?.function
    powerShell = process.platform === "win32" && shell?.description?.includes("PowerShell") === true
    if (process.platform === "win32") assert.ok(powerShell, "expected the configured native PowerShell tool")
    return packet([call("invalid", "write", invalid)])
  }
  if (turn === 1) {
    assert.ok(body.messages.some((m) => m.role === "tool" && m.tool_call_id === "invalid"))
    const calls = [call("missing-path", "write", { content: oversized })]
    if (powerShell) calls.push(call("wrong-shell", "shell", {
      command: "cat > partial.html << 'EOF'\n" + "SHELL_BODY_".repeat(2100) + "\nEOF",
    }))
    return packet(calls)
  }
  if (turn === 2) {
    assert.ok(body.messages.some((m) => m.role === "tool" && m.tool_call_id === "missing-path"))
    assert.ok(!history.includes("REJECTED_BODY_"), "the rejected file content was retransmitted")
    if (powerShell) {
      const rejected = body.messages.find((m) => m.role === "tool" && m.tool_call_id === "wrong-shell")
      assert.ok(JSON.stringify(rejected)?.includes("PowerShell") && !history.includes("SHELL_BODY_"))
    }
    return packet(names.map((file, i) => call("write-" + i, "write", { filePath: file, content: files[file] })))
  }
  if (turn === 3) {
    assert.ok(names.every((_, i) => body.messages.some((m) => m.role === "tool" && m.tool_call_id === "write-" + i)))
    return undefined // an HTTP body-size rejection after work has actually reached disk
  }
  if (turn === 4) {
    assert.ok(history.includes("## Objective"), "expected a smaller summary request after the rejection")
    summarized = true
    return packet([], "## Objective\n" + prompt + "\n## Completed\n- index.html, site.css and app.js have been written. Read index.html to verify before finishing.")
  }
  if (turn === 5) {
    assert.ok(history.includes("<summary>") && history.includes("index.html"))
    recovered = true
    return packet([call("verify", "read", { filePath: "index.html", limit: 8 })])
  }
  assert.equal(turn, 6, "unexpected additional provider call")
  const result = body.messages.find((m) => m.role === "tool" && m.tool_call_id === "verify")
  assert.ok(JSON.stringify(result)?.includes("فروش API هوش مصنوعی"), "read did not return the saved page")
  return packet([], title)
}

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname
    if (pathname === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" })
      return res.end(JSON.stringify({ object: "list", data: [{ id: model, object: "model" }] }))
    }
    if (pathname === "/v1/chat/completions") {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const answer = completion(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      res.writeHead(answer ? 200 : 413, { "Content-Type": "application/json" })
      return res.end(JSON.stringify(answer ?? { error: { message: "حجم درخواست بیش از حد مجاز است." } }))
    }
    const file = pathname.slice(1)
    if (!names.includes(file)) { res.writeHead(404); return res.end() }
    const mime = { "index.html": "text/html", "site.css": "text/css", "app.js": "application/javascript" }
    res.writeHead(200, { "Content-Type": mime[file] + "; charset=utf-8" })
    res.end(await readFile(path.join(project, file)))
  } catch (error) {
    failure ??= error
    res.writeHead(400, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: { message: "Fixture assertion failed" } }))
  }
})
server.listen(0, "127.0.0.1")
await once(server, "listening")
const origin = "http://127.0.0.1:" + server.address().port
let browser
try {
  const settings = { providers: { panaai: { settings: { baseURL: origin + "/v1", apiKey: "local-fixture" } } } }
  if (process.platform === "win32") settings.shell = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  const env = { ...process.env, PWD: other, HOME: home, USERPROFILE: home, APPDATA: path.join(home, "roaming"),
    LOCALAPPDATA: path.join(home, "local"), PANACODE_TEST_HOME: home, PANACODE_DB: path.join(home, "panacode.db"),
    XDG_CACHE_HOME: path.join(home, "cache"), XDG_DATA_HOME: path.join(home, "data"),
    XDG_CONFIG_HOME: path.join(home, "config"), XDG_STATE_HOME: path.join(home, "state"),
    PANACODE_DISABLE_FILEWATCHER: "true", PANACODE_DISABLE_MODELS_FETCH: "true",
    PANACODE_CONFIG_CONTENT: JSON.stringify(settings),
  }
  const child = spawn(bin, [...entry, "run", "--standalone", "--auto", "--format", "json", "--title", "آزمون ساخت صفحه", "--model", "panaai/" + model + "#high", prompt],
    { cwd: project, env, stdio: ["ignore", "pipe", "pipe"], timeout: 100_000, windowsHide: true })
  let output = ""
  let errors = ""
  child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk })
  child.stderr.setEncoding("utf8").on("data", (chunk) => { errors = (errors + chunk).slice(-4000) })
  const [code, signal] = await once(child, "close")
  if (failure) throw failure
  if (code !== 0) throw new Error("CLI failed at replay round " + rounds + ": " + (signal ?? code) + "; " +
    errors.slice(-800) + " " + output.split("\n").findLast((line) => line.includes('"type":"error"'))?.slice(0,320))
  assert.ok(summarized && recovered && rounds === 7)
  const events = output.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  const tools = events.filter((event) => event.type === "tool_use").map((e) => e.part)
  for (const id of ["invalid", "missing-path"]) assert.ok(tools.some((t) => t.id === id && t.state.status === "error"))
  for (const id of ["write-0", "write-1", "write-2", "verify"])
    assert.equal(tools.filter((t) => t.id === id && t.state.status === "completed").length, 1)
  assert.ok(events.some((e) => e.type === "text" && e.part?.text?.includes(title)))
  await assert.rejects(access(path.join(project, "partial.html")), { code: "ENOENT" })
  for (const name of names) {
    assert.equal(await readFile(path.join(project, name), "utf8"), files[name])
    await assert.rejects(access(path.join(other, name)), { code: "ENOENT" })
  }
  console.log("Verified tool outcomes, correct project, exact file bytes and recovery through the packaged CLI.")
  browser = await chromium.launch(process.platform === "win32" ? { channel: "msedge" } : { executablePath: "/usr/bin/chromium" })
  const page = await browser.newPage()
  const jsErrors = []
  page.on("pageerror", (err) => jsErrors.push(err.message))
  await page.goto(origin + "/index.html")
  assert.equal(await page.locator("html").getAttribute("dir"), "rtl")
  await page.getByRole("button", { name: "شروع" }).click({ timeout: 5000 })
  assert.equal(await page.locator("output").innerText(), "آماده")
  assert.deepEqual(jsErrors, [])
  console.log("Installed tool replay passed: malformed input, missing path, real file writes, 413 recovery, file read and interactive Persian landing page.")
} finally {
  try { await browser?.close() } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
