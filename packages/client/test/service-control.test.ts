import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Info } from "../src/service"
import { request } from "../src/service-control"

async function controlServer(
  reply: (request: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>,
) {
  const directory = await mkdtemp(path.join(tmpdir(), "panacode-control-"))
  const socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\panacode-control-test-${process.pid}-${crypto.randomUUID()}`
      : path.join(directory, "control.sock")
  const requests: Array<Record<string, unknown>> = []
  const server: Server = createServer((socket) => {
    let input = ""
    socket.setEncoding("utf8")
    socket.on("data", async (chunk: string) => {
      input += chunk
      const newline = input.indexOf("\n")
      if (newline < 0) return
      const parsed = JSON.parse(input.slice(0, newline)) as Record<string, unknown>
      requests.push(parsed)
      socket.end(JSON.stringify(await reply(parsed)) + "\n")
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(socketPath, () => resolve())
  })
  return {
    path: socketPath,
    requests,
    async [Symbol.asyncDispose]() {
      server.closeAllConnections?.()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    },
  }
}

function info(control: { path: string; token: string }, input: Partial<Info> = {}): Info {
  return {
    id: "instance-a",
    product: "panacode",
    version: "2.0.0",
    url: "http://127.0.0.1:4096/",
    pid: process.pid,
    password: "public-password",
    control,
    ...input,
  }
}

test("the private control channel proves the registered instance and process", async () => {
  await using server = await controlServer((request) => ({
    ok: true,
    id: request.id,
    pid: process.pid,
    action: request.action,
  }))
  const target = info({ path: server.path, token: "control-secret" })

  expect(await request(target, "ping", 1_000)).toEqual({ ok: true })
  expect(await request(target, "shutdown", 1_000)).toEqual({ ok: true })
  expect(server.requests.map((value) => value.action)).toEqual(["ping", "shutdown"])
  expect(server.requests[0]).toMatchObject({ id: "instance-a", token: "control-secret", version: 1 })
})

test("a wrong control token is denied and never becomes a shutdown", async () => {
  await using server = await controlServer((request) => ({
    ok: request.token === "control-secret",
    id: request.id,
    pid: process.pid,
  }))
  const target = info({ path: server.path, token: "wrong-secret" })

  const result = await request(target, "shutdown", 1_000)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error("expected denial")
  expect(result.reason).toBe("denied")
  expect(server.requests).toHaveLength(1)
})

test("a reply from a different instance or process is rejected", async () => {
  let expected: Partial<Info> = {}
  await using server = await controlServer(() => ({
    ok: true,
    id: "instance-b",
    pid: expected.pid,
  }))
  const a = info({ path: server.path, token: "control-secret" })
  expected = a

  const wrongInstance = await request(a, "shutdown", 1_000)
  expect(wrongInstance).toMatchObject({ ok: false, reason: "mismatch" })

  const wrongPID = await request({ ...a, pid: a.pid + 1 }, "ping", 1_000)
  expect(wrongPID).toMatchObject({ ok: false, reason: "mismatch" })
})

test("a registration without a control channel cannot stop a process", async () => {
  const target = { ...info({ path: "unused", token: "unused" }), control: undefined }
  const result = await request(target, "shutdown", 1_000)
  expect(result).toMatchObject({ ok: false, reason: "unavailable" })
})