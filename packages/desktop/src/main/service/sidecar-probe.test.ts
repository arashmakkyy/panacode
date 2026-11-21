import { expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startSidecarProbe, takeSidecarProbe } from "./sidecar-probe"

const version = "0.0.0-probe"

test("adopts a keyed probe once", async () => {
  await using service = await probeFixture()
  const key = service.key()
  const started = startSidecarProbe({ key })
  await started

  expect(await takeSidecarProbe(key)).toEqual({
    status: "adopted",
    endpoint: {
      url: service.url,
      auth: { type: "basic", username: "opencode", password: service.password },
    },
  })
  expect(await takeSidecarProbe(key)).toEqual({ status: "miss" })
})

test("a second state root never adopts another root's service", async () => {
  await using a = await probeFixture()
  await using b = await probeFixture()
  const started = startSidecarProbe({ key: a.key() })
  await started

  expect(await takeSidecarProbe(b.key())).toEqual({
    status: "discarded",
    reason: "key-mismatch",
  })
  expect(a.requests()).toBe(1)
  expect(b.requests()).toBe(0)
})

test("discards a probe when the registration identity changed", async () => {
  await using service = await probeFixture()
  const key = service.key()
  const started = startSidecarProbe({ key })
  await started

  await writeFile(service.file, JSON.stringify({ ...service.registration(), id: randomUUID() }))

  expect(await takeSidecarProbe(key)).toEqual({ status: "discarded", reason: "identity-changed" })
})

test("discards a probe when the registration is no longer owned", async () => {
  await using service = await probeFixture()
  const key = service.key()
  const started = startSidecarProbe({ key })
  await started

  const foreign = { ...service.registration() } as Record<string, unknown>
  delete foreign.product
  await writeFile(service.file, JSON.stringify(foreign))

  expect(await takeSidecarProbe(key)).toEqual({ status: "discarded", reason: "identity-changed" })
})

test("misses when no service is registered", async () => {
  await using service = await probeFixture()
  const file = join(service.directory, "missing", "service.json")
  const key = { ...service.key(), file }
  await startSidecarProbe({ key })

  expect(await takeSidecarProbe(key)).toEqual({ status: "miss" })
})

async function probeFixture() {
  const directory = await mkdtemp(join(tmpdir(), "panacode-sidecar-probe-"))
  const file = join(directory, "service.json")
  const password = randomUUID()
  const id = randomUUID()
  let requests = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests++
      if (new URL(request.url).pathname !== "/api/info") return new Response("not found", { status: 404 })

      return Response.json({ version, instance: id, pid: process.pid, product: "panacode" })
    },
  })
  const url = `http://127.0.0.1:${server.port}`
  const registration = () => ({
    id,
    product: "panacode" as const,
    version,
    url,
    pid: process.pid,
    password,
  })
  await writeFile(file, JSON.stringify(registration()))

  return {
    directory,
    file,
    url,
    password,
    registration,
    key: () => ({ stateRoot: directory, file, version, local: false }),
    requests: () => requests,
    async [Symbol.asyncDispose]() {
      server.stop(true)
      await rm(directory, { recursive: true, force: true })
    },
  }
}