import { expect, test } from "bun:test"
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises"
import { connect, createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Info } from "../src/service"
import { testControl } from "./fixture/control"
import { answerControl, exchange, request } from "../src/service-control"

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
  let stopped = 0
  const identity = info({ path: "", token: "" })
  await using server = await testControl(
    () => identity,
    () => {
      stopped++
    },
  )
  const target = { ...identity, control: server.control }
  expect(await request(target, "ping", 1_000)).toEqual({ ok: true })
  expect(await request(target, "shutdown", 1_000)).toEqual({ ok: true })
  await Bun.sleep(10)
  expect(stopped).toBe(1)
})

test("an unverified peer gets neither the private token nor an authorization proof", async () => {
  await using server = await controlServer(() => ({ ok: true }))
  const target = info({ path: server.path, token: "control-secret" })
  expect(await request(target, "shutdown", 1_000)).toMatchObject({ ok: false })
  expect(server.requests).toHaveLength(1)
  expect(server.requests[0]).toMatchObject({ version: 2, action: "shutdown" })
  expect(server.requests[0]).not.toHaveProperty("proof")
  expect(JSON.stringify(server.requests)).not.toContain(target.control!.token)
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

test("mutual proof binds both directions, the registered address and encrypted terminal handoff", async () => {
  const owner = info({ path: "unused", token: "local-key" })
  const actions: string[] = []
  const transcript: string[] = []
  const server = createServer((socket) => {
    socket.on("data", (data) => transcript.push(String(data)))
    answerControl(
      socket,
      owner,
      "local-key",
      () => actions.push("stop"),
      async (action) => {
        actions.push(action)
        return { ticket: "private-terminal-ticket" }
      },
    )
  })
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject))
  try {
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing test address")
    const stream = () => {
      const socket = connect(address.port, "127.0.0.1")
      socket.on("data", (data) => transcript.push(String(data)))
      return socket
    }
    expect(
      await exchange(stream(), { ...owner, url: "http://127.0.0.1:1" }, "local-key", "shutdown", 1_000),
    ).toMatchObject({ ok: false })
    expect(
      await exchange(stream(), { ...owner, password: "stale-http-password" }, "local-key", "ping", 1_000),
    ).toMatchObject({ ok: false })
    expect(await exchange(stream(), owner, "wrong-key", "shutdown", 1_000)).toMatchObject({ ok: false })
    expect(await exchange(stream(), owner, "local-key", "pty-handoff", 1_000)).toEqual({
      ok: true,
      value: { ticket: "private-terminal-ticket" },
    })
    expect(actions).toEqual(["pty-handoff"])
    expect(transcript.join("")).not.toContain("local-key")
    expect(transcript.join("")).not.toContain("private-terminal-ticket")
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("an unconfirmed terminal shutdown preserves the registration and ticket for retry", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "panacode-pty-retry-"))
  const file = path.join(directory, "service.json")
  const identity = info({ path: "", token: "" })
  let shutdown = false
  await using control = await testControl(
    () => identity,
    () => {
      shutdown = true
    },
    async () => {
      throw new Error("Temporarily unavailable")
    },
  )
  try {
    const target = { ...identity, control: control.control }
    await writeFile(file, JSON.stringify(target), { mode: 0o600 })
    await writeFile(file + ".pty-handoff", "preserve ticket")
    const { stop } = await import("../src/promise/service")
    await expect(stop({ file, pty: "shutdown" })).rejects.toThrow("control")
    expect(shutdown).toBe(false)
    expect(await readFile(file + ".pty-handoff", "utf8")).toBe("preserve ticket")
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(target)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
