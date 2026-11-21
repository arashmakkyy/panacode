import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { discover, ensure as ensureService, stop as stopService } from "../src/promise/service"
import { accelerate } from "./fixture/service-timing"

const ensure = accelerate(ensureService)
const stop = accelerate(stopService)

// A client may only stop a process that proves it owns the registration over the private
// per-instance channel. A registration that merely names a PID, or answers as a different
// instance, must never be allowed to control that process.

function spawnWitness(heartbeat: string) {
  return Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/witness.ts"), heartbeat], {
    stdio: ["ignore", "ignore", "ignore"],
  })
}

async function waitForHeartbeat(file: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if ((await beats(file)) > 0) return
    await Bun.sleep(10)
  }
  throw new Error("witness did not start")
}

async function beats(file: string) {
  return (await Bun.file(file).text().catch(() => ""))
    .split("\n")
    .filter((line) => line.length > 0).length
}

async function controlServer(reply: "mismatch" | "hang") {
  const directory = await mkdtemp(path.join(tmpdir(), "panacode-witness-control-"))
  const socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\panacode-witness-${process.pid}-${crypto.randomUUID()}`
      : path.join(directory, "control.sock")
  const sockets = new Set<Socket>()
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    socket.setEncoding("utf8")
    socket.on("data", (chunk: string) => {
      if (reply === "hang" || !chunk.includes("\n")) return
      // It proves the socket is reachable but claims a different instance.
      socket.end(JSON.stringify({ ok: true, id: "another-instance", pid: process.pid, action: "ping" }) + "\n")
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(socketPath, () => {
      server.off("error", reject)
      resolve()
    })
  })
  return {
    path: socketPath,
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    },
  }
}

test("a registration that cannot prove ownership never stops or replaces a foreign process", async () => {
  await using root = await fixtureRoot()
  const registration = path.join(root.path, "service.json")
  const heartbeat = path.join(root.path, "heartbeat")
  const marker = path.join(root.path, "replacement-started")
  const witness = spawnWitness(heartbeat)
  const health = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 401 }) })
  const control = await controlServer("mismatch")
  try {
    await waitForHeartbeat(heartbeat)
    await writeFile(
      registration,
      JSON.stringify({
        id: "claimed-instance",
        product: "panacode",
        version: "test",
        url: health.url.href,
        pid: witness.pid,
        password: "secret",
        control: { path: control.path, token: "wrong-token" },
      }),
    )
    const replacement = [process.execPath, path.join(import.meta.dir, "fixture/marker.ts"), marker]

    expect(await discover({ file: registration })).toBeUndefined()
    await expect(ensure({ file: registration, version: "test", command: replacement })).rejects.toThrow(
      "rejected the service credential",
    )
    await expect(stop({ file: registration })).rejects.toThrow("different instance")

    expect(await Bun.file(marker).exists()).toBe(false)
    expect(await Bun.file(registration).json()).toMatchObject({ id: "claimed-instance", pid: witness.pid })
    const before = await beats(heartbeat)
    await Bun.sleep(120)
    expect(await beats(heartbeat)).toBeGreaterThan(before)
    expect(() => process.kill(witness.pid, 0)).not.toThrow()
  } finally {
    witness.kill()
    await witness.exited
    health.stop(true)
    await control.close()
  }
})

test("a legacy record without product or instance identity is never adopted, stopped, or replaced", async () => {
  await using root = await fixtureRoot()
  const registration = path.join(root.path, "service.json")
  const heartbeat = path.join(root.path, "heartbeat")
  const marker = path.join(root.path, "replacement-started")
  const witness = spawnWitness(heartbeat)
  const health = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 401 }) })
  try {
    await waitForHeartbeat(heartbeat)
    await writeFile(
      registration,
      JSON.stringify({
        url: health.url.href,
        pid: witness.pid,
        version: "test",
        password: "legacy-secret",
      }),
    )
    const replacement = [process.execPath, path.join(import.meta.dir, "fixture/marker.ts"), marker]

    expect(await discover({ file: registration })).toBeUndefined()
    await expect(ensure({ file: registration, version: "test", command: replacement })).rejects.toThrow(
      "refusing to reuse or replace it",
    )
    await expect(stop({ file: registration })).rejects.toThrow("Refusing to stop an unidentified process")

    expect(await Bun.file(marker).exists()).toBe(false)
    expect(await Bun.file(registration).json()).toMatchObject({ pid: witness.pid })
    expect(() => process.kill(witness.pid, 0)).not.toThrow()
  } finally {
    witness.kill()
    await witness.exited
    health.stop(true)
  }
})

test("a control channel that never answers leaves the registered process running", async () => {
  await using root = await fixtureRoot()
  const registration = path.join(root.path, "service.json")
  const heartbeat = path.join(root.path, "heartbeat")
  const witness = spawnWitness(heartbeat)
  const health = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 401 }) })
  const control = await controlServer("hang")
  try {
    await waitForHeartbeat(heartbeat)
    await writeFile(
      registration,
      JSON.stringify({
        id: "silent-instance",
        product: "panacode",
        version: "test",
        url: health.url.href,
        pid: witness.pid,
        password: "secret",
        control: { path: control.path, token: "control-secret" },
      }),
    )

    await expect(stop({ file: registration })).rejects.toThrow("Timed out waiting for the local service control channel")
    expect(() => process.kill(witness.pid, 0)).not.toThrow()
    expect(await Bun.file(registration).exists()).toBe(true)
  } finally {
    witness.kill()
    await witness.exited
    health.stop(true)
    await control.close()
  }
})

async function fixtureRoot() {
  const directory = await mkdtemp(path.join(tmpdir(), "panacode-witness-"))
  return {
    path: directory,
    async [Symbol.asyncDispose]() {
      await rm(directory, { recursive: true, force: true })
    },
  }
}
