import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import { createServer, type Server, type Socket } from "node:net"
import os from "node:os"
import path from "node:path"

// Real CLI commands against a registration whose PID belongs to a fixture-owned witness. The
// witness must answer after every operation, and no HTTP action may reach a process that only
// matches the public health identity.

test("service restart refuses an unidentified registration and leaves its process running", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-service-witness-"))
  const state = path.join(root, "state", "panacode")
  const heartbeat = path.join(root, "heartbeat")
  await fs.mkdir(state, { recursive: true })
  const witness = await startWitness(heartbeat)
  const registration = path.join(state, "service-local.json")
  const record = {
    url: "http://127.0.0.1:1/",
    pid: witness.pid,
    version: "test",
    password: "legacy-secret",
  }
  try {
    await fs.writeFile(registration, JSON.stringify(record))
    const before = await beats(heartbeat)

    const result = await cli(["service", "restart"], root)

    expect(result.exitCode).not.toBe(0)
    expect(result.stdout + result.stderr).toContain("Refusing to stop an unidentified process")
    expect(await fs.readFile(registration, "utf8")).toBe(JSON.stringify(record))
    expect(await fs.readdir(state)).toEqual(["service-local.json"])
    await Bun.sleep(120)
    expect(await beats(heartbeat)).toBeGreaterThan(before)
    expect(() => process.kill(witness.pid, 0)).not.toThrow()
  } finally {
    witness.kill()
    await witness.exited
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("uninstall does not send a PTY shutdown to an endpoint that only matches the public identity", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-pty-witness-"))
  const state = path.join(root, "state", "panacode")
  const heartbeat = path.join(root, "heartbeat")
  await fs.mkdir(state, { recursive: true })
  const witness = await startWitness(heartbeat)
  const ptyRequests: string[] = []
  const id = "instance-a"
  const health = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url)
      if (url.pathname === "/api/info")
        return Response.json({ version: "test", instance: id, pid: witness.pid, product: "panacode" })
      ptyRequests.push(`${request.method} ${url.pathname}`)
      return new Response(null, { status: 204 })
    },
  })
  const control = await controlServer()
  const registration = path.join(state, "service-local.json")
  try {
    await fs.writeFile(
      registration,
      JSON.stringify({
        id,
        product: "panacode",
        version: "test",
        url: health.url.href,
        pid: witness.pid,
        password: "public-secret",
        control: { path: control.path, token: "control-secret" },
      }),
    )
    const before = await beats(heartbeat)

    const result = await cli(["uninstall", "--force"], root)

    expect(result.exitCode).not.toBe(0)
    expect(result.stdout + result.stderr).toContain("different instance")
    expect(ptyRequests).toEqual([])
    expect(await Bun.file(registration).exists()).toBe(true)
    await Bun.sleep(120)
    expect(await beats(heartbeat)).toBeGreaterThan(before)
    expect(() => process.kill(witness.pid, 0)).not.toThrow()
  } finally {
    witness.kill()
    await witness.exited
    health.stop(true)
    await control.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

function startWitness(heartbeat: string) {
  return Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/witness.ts"), heartbeat], {
    stdio: ["ignore", "ignore", "ignore"],
  })
}

async function beats(file: string) {
  return (await Bun.file(file).text().catch(() => "")).split("\n").filter((line) => line.length > 0).length
}

// A reachable private channel that claims a different instance: it proves the endpoint is not the
// process from the registration without ever accepting a shutdown action.
async function controlServer() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-witness-cli-control-"))
  const pipe =
    process.platform === "win32"
      ? `\\\\.\\pipe\\panacode-witness-cli-${process.pid}-${crypto.randomUUID()}`
      : path.join(directory, "control.sock")
  const sockets = new Set<Socket>()
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    socket.setEncoding("utf8")
    socket.on("data", () => {
      socket.end(
        JSON.stringify({ ok: true, id: "another-instance", pid: process.pid, action: "ping" }) + "\n",
      )
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(pipe, () => {
      server.off("error", reject)
      resolve()
    })
  })
  return {
    path: pipe,
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await fs.rm(directory, { recursive: true, force: true })
    },
  }
}

async function cli(args: string[], root: string) {
  const child = Bun.spawn([process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), ...args], {
    cwd: path.join(import.meta.dir, ".."),
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_STATE_HOME: path.join(root, "state"),
      PANACODE_CONFIG_DIR: path.join(root, "config", "panacode"),
      PANACODE_TEST_HOME: root,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}