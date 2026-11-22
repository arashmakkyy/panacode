import { answerControl } from "../../src/service-control"
import { healthProof } from "./control"
import { serviceProofPath } from "@opencode/schema/service-proof"
import { createHash, randomBytes } from "node:crypto"
import { appendFile, chmod, mkdir, rename, rm, unlink, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import path from "node:path"

const [registration, mode, delay] = process.argv.slice(2)
if (registration === undefined || mode === undefined) throw new Error("Missing service fixture arguments")
if (mode === "failed") process.exit(1)
if (mode === "stderr-failed") {
  process.stderr.write("x".repeat(16_384) + "\nactionable startup failure\n")
  process.exit(1)
}
if (mode === "stderr-secrets") {
  process.stderr.write("password=service-password\ntoken: control-token\nAuthorization: Basic dXNlcjpwYXNz\n")
  process.exit(1)
}
if (mode === "record-start") {
  await writeFile(registration + ".started", "")
  process.exit(1)
}
if (mode === "environment") {
  await writeFile(registration + ".environment", process.env.PANACODE_SERVICE_ENV_TEST ?? "")
  await writeFile(registration + ".handoff", process.env.PANACODE_PTY_HANDOFF ?? "null")
}
if (mode === "signal") process.kill(process.pid, process.platform === "win32" ? "SIGTERM" : "SIGKILL")

let controlled = ""
if (mode === "controlled") {
  await appendFile(registration + ".starts", process.pid + "\n")
  const release = registration + `.release-${process.pid}`
  while (!(await Bun.file(release).exists())) await Bun.sleep(5)
  controlled = await Bun.file(release).text()
  if (controlled === "fail") {
    process.stderr.write("actionable startup failure: storage initialization denied\n")
    process.exit(23)
  }
}

if (mode === "unregistered") await appendFile(registration + ".starts", process.pid + "\n")
if (mode === "delayed" || mode === "delayed-failed" || mode === "coordinated" || mode === "coordinated-failed-loser") {
  await appendFile(registration + ".starts", process.pid + "\n")
  const owner = await writeFile(registration + ".owner", String(process.pid), { flag: "wx" })
    .then(() => true)
    .catch(() => false)
  if (!owner) process.exit(mode === "coordinated-failed-loser" ? 1 : 0)
  if (mode === "coordinated" || mode === "coordinated-failed-loser") {
    while ((await Bun.file(registration + ".starts").text()).trim().split("\n").length < 2) await Bun.sleep(10)
    if (mode === "coordinated-failed-loser") await Bun.sleep(Number(delay ?? 1_500))
  } else await Bun.sleep(Number(delay))
  if (mode === "delayed-failed") process.exit(1)
}

let requests = 0
let version = "test"
if (mode === "old" || mode === "handoff") version = "old"
if (mode === "incompatible") version = "1.9.0"
if (mode === "compatible" || mode === "delayed-compatible") version = "2.1.0-next.1"
const id = crypto.randomUUID()
const controlPath =
  process.platform === "win32"
    ? `\\\\.\\pipe\\panacode-fixture-${createHash("sha256").update(registration).digest("hex").slice(0, 12)}-${process.pid}`
    : path.join(path.dirname(registration), `${id}.sock`)
const controlToken = randomBytes(24).toString("base64url")
const control = createServer((socket) => {
  answerControl(
    socket,
    { product: "panacode", id, pid: process.pid, version, url: server.url.href, password: "private" },
    controlToken,
    () => void shutdown("CONTROL"),
    async (action) => {
      if (action === "pty-shutdown") return null
      if (mode === "handoff-broken") throw new Error("Terminal subsystem unavailable")
      if (mode === "protocol") await writeFile(registration + ".handoff-request", "")
      if (mode === "handoff") {
        await writeFile(registration + ".prepared", JSON.stringify(handoff))
        return handoff
      }
      return null
    },
  )
})
if (process.platform !== "win32") {
  await mkdir(path.dirname(controlPath), { recursive: true, mode: 0o700 })
  await chmod(path.dirname(controlPath), 0o700)
  await unlink(controlPath).catch(() => undefined)
}
await new Promise<void>((resolve, reject) => {
  control.once("error", reject)
  control.listen(controlPath, () => {
    control.off("error", reject)
    resolve()
  })
})
if (process.platform !== "win32") await chmod(controlPath, 0o600)
const handoff = {
  directory: registration + ".daemon",
  instanceID: crypto.randomUUID(),
  ticket: crypto.randomUUID(),
  expiresAt: Date.now() + 30_000,
}
const server = Bun.serve({
  port: mode === "unregistered" ? Number(delay) : 0,
  async fetch(request): Promise<Response> {
    const pathname = new URL(request.url).pathname
    if (mode === "protocol" && pathname === "/api/experimental/persistent-pty/handoff") {
      await writeFile(registration + ".handoff-request", "")
      return Response.json({ handoff: null })
    }
    if (pathname === "/api/experimental/persistent-pty/handoff" && mode === "handoff") {
      if (request.method !== "POST" || request.headers.get("authorization") !== "Basic " + btoa("opencode:private"))
        return new Response(null, { status: 401 })
      await writeFile(registration + ".prepared", JSON.stringify(handoff))
      return Response.json({ handoff })
    }
    if (pathname === "/api/experimental/persistent-pty/handoff" && mode === "handoff-broken")
      return new Response(null, { status: 500 })
    if (pathname !== "/api/info" && pathname !== serviceProofPath) return new Response(null, { status: 404 })
    if (mode === "unauthorized") return new Response(null, { status: 401 })
    if (mode === "redirect") return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:1/" } })
    if (mode === "invalid-health") return new Response("not json", { status: 200 })
    if (mode === "protocol" && (await Bun.file(registration + ".missing-health").exists()))
      return new Response(null, { status: 404 })
    requests += 1
    if (mode === "starting") await writeFile(registration + ".status-request", "")
    if (mode === "unregistered") await writeFile(registration + ".unregistered-request", "")
    if (mode === "hanging" || controlled === "hang") {
      await appendFile(registration + ".requests", process.pid + "\n")
      return new Promise<Response>(() => {})
    }
    const product = mode === "opencode" ? "opencode" : "panacode"
    const instance = mode === "wrong-instance" ? crypto.randomUUID() : mode === "no-instance" ? undefined : id
    if (mode === "modern" && requests === 1) {
      await writeFile(registration + ".first-request", "")
      while (!(await Bun.file(registration + ".release").exists())) await Bun.sleep(5)
      if (pathname === serviceProofPath) return healthProof(request, controlToken, id, "starting")
      return Response.json(
        {
          version,
          pid: process.pid,
          instance,
          product,
          urls: [server.url.toString()],
          paths: { tmp: "/tmp/opencode" },
        },
        { status: 503 },
      )
    }
    if (mode === "starting" && !(await Bun.file(registration + ".release").exists())) {
      if (pathname === serviceProofPath) return healthProof(request, controlToken, id, "starting")
      return Response.json(
        {
          version,
          pid: process.pid,
          instance,
          product,
          urls: [server.url.toString()],
          paths: { tmp: "/tmp/opencode" },
        },
        { status: 503 },
      )
    }
    if (pathname === serviceProofPath) {
      if (!instance || product !== "panacode") return new Response(null, { status: 403 })
      return healthProof(request, controlToken, instance, mode === "failed-owner" ? "failed" : "ready")
    }
    if (mode === "failed-owner")
      return Response.json(
        {
          version,
          pid: process.pid,
          instance,
          product,
          urls: [server.url.toString()],
          paths: { tmp: "/tmp/opencode" },
        },
        { status: 500 },
      )
    return Response.json({
      version,
      pid: process.pid,
      instance,
      product,
      urls: [server.url.toString()],
      paths: { tmp: "/tmp/opencode" },
    })
  },
})

// Install handlers before publishing: a test may signal as soon as the registration appears.
if (controlled !== "hang") {
  process.on("SIGTERM", () => void shutdown("SIGTERM"))
  process.on("SIGINT", () => void shutdown("SIGINT"))
}

if (mode === "unregistered") {
  while (!(await Bun.file(registration + ".register-release").exists())) await Bun.sleep(5)
}

await writeFile(
  registration + ".tmp",
  JSON.stringify({
    id,
    product: "panacode",
    version,
    url: server.url.toString(),
    pid: process.pid,
    password: "private",
    control: { path: controlPath, token: controlToken },
  }),
  { mode: 0o600 },
)
await rename(registration + ".tmp", registration)

async function shutdown(source: string = "CONTROL") {
  if (mode === "draining") {
    control.close()
    await writeFile(registration + ".draining", "")
    await Bun.sleep(700)
    server.stop(true)
    process.exit(0)
  }
  await writeFile(registration + ".signal", source)
  // A lingering server unregisters on shutdown but keeps running, and holds its port, until killed.
  if (mode === "lingering") {
    await rm(registration, { force: true })
    await writeFile(registration + ".unregistered", "")
    await Bun.sleep(Number(delay))
  }
  server.stop(true)
  control.close()
  if (process.platform !== "win32") await unlink(controlPath).catch(() => undefined)
  process.exit()
}
