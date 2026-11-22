import { healthProof, testControl } from "../../../../client/test/fixture/control"
import { serviceProofPath } from "@opencode/schema/service-proof"
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

  const foreign = Object.fromEntries(Object.entries(service.registration()).filter(([key]) => key !== "product"))

  await writeFile(service.file, JSON.stringify(foreign))

  expect(await takeSidecarProbe(key)).toEqual({ status: "discarded", reason: "identity-changed" })
})

test("an endpoint cannot acquire a newer registration identity during an in-flight discovery", async () => {
  const observed = Promise.withResolvers<void>()
  const resume = Promise.withResolvers<void>()
  await using service = await probeFixture(async () => {
    observed.resolve()
    await resume.promise
  })
  const key = service.key()
  const probing = startSidecarProbe({ key })
  await observed.promise
  await writeFile(service.file, JSON.stringify({ ...service.registration(), id: randomUUID() }))
  resume.resolve()
  await probing
  expect(await takeSidecarProbe(key)).toEqual({ status: "miss" })
})

test("misses when no service is registered", async () => {
  await using service = await probeFixture()
  const file = join(service.directory, "missing", "service.json")
  const key = { ...service.key(), file }
  await startSidecarProbe({ key })

  expect(await takeSidecarProbe(key)).toEqual({ status: "miss" })
})

async function probeFixture(onRequest?: () => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "panacode-sidecar-probe-"))
  const file = join(directory, "service.json")
  const password = randomUUID()
  const id = randomUUID()
  let requests = 0

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests++
      await onRequest?.()

      if (new URL(request.url).pathname !== serviceProofPath) return new Response("not found", { status: 404 })
      return healthProof(request, channel.control.token, id)
    },
  })

  const url = `http://127.0.0.1:${server.port}`

  const identity = () => ({
    id,
    product: "panacode" as const,
    version,
    url,
    pid: process.pid,
    password,
  })

  const channel = await testControl(identity)
  const registration = () => ({ ...identity(), control: channel.control })
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
      await channel[Symbol.asyncDispose]()
      server.stop(true)
      await rm(directory, { recursive: true, force: true })
    },
  }
}
