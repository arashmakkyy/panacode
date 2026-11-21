import { NodeFileSystem } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Service } from "../src/effect/service"
import { ensure, discover, stop } from "../src/promise/service"
import type { DiscoverOptions, EnsureOptions, EnsureReason, StopOptions } from "../src/service"
import { serviceFixture, stopSignal, stoppedExitCode } from "./fixture/service-fixture"
import { accelerate } from "./fixture/service-timing"

const effect = accelerate(Service.ensure)
const clients = [
  { name: "Promise", discover, ensure: accelerate(ensure), stop },
  {
    name: "Effect",
    discover: (options: DiscoverOptions) =>
      Effect.runPromise(Service.discover(options).pipe(Effect.provide(NodeFileSystem.layer))),
    ensure: (options: EnsureOptions) => Effect.runPromise(effect(options).pipe(Effect.provide(NodeFileSystem.layer))),
    stop: (options: StopOptions) => Effect.runPromise(Service.stop(options).pipe(Effect.provide(NodeFileSystem.layer))),
  },
]

for (const client of clients) {
  for (const policy of [
    { name: "no version requirement", version: undefined },
    { name: "matching exact version", version: "test" },
    { name: "accepting version predicate", version: (version: string) => version === "test" },
  ]) {
    test(`${client.name} reconnect preserves a protocol-incompatible owner with ${policy.name}`, async () => {
      await using fixture = await serviceFixture()
      const owner = fixture.spawn("protocol")
      await fixture.waitForFile()
      const original = await Bun.file(fixture.registration).json()
      const starts: EnsureReason[] = []
      const options = {
        file: fixture.registration,
        version: policy.version,
        command: fixture.command("record-start"),
        onStart: (reason: EnsureReason) => starts.push(reason),
      }
      expect((await client.ensure(options)).url).toBe(original.url)

      // The same process remains alive. Only its health endpoint becomes unavailable.
      await Bun.write(fixture.registration + ".missing-health", "")
      const error = await client.ensure(options).catch((error: unknown) => error)
      expect(await Bun.file(fixture.registration + ".signal").exists()).toBe(false)
      expect(await Bun.file(fixture.registration + ".handoff-request").exists()).toBe(false)
      expect(await Bun.file(fixture.registration + ".started").exists()).toBe(false)
      expect(starts).toEqual([])
      expect(owner.exitCode).toBe(null)
      expect(await Bun.file(fixture.registration).json()).toEqual(original)
      expect(error).toBeInstanceOf(Error)
      if (!(error instanceof Error)) throw error
      expect(error.message).toContain("incompatible health protocol")

      await Bun.file(fixture.registration + ".missing-health").delete()
      expect((await client.ensure(options)).url).toBe(original.url)
      expect(owner.exitCode).toBe(null)
    })
  }

  test(`${client.name} refuses to replace a protocol-incompatible owner when the version differs`, async () => {
    await using fixture = await serviceFixture()
    const owner = fixture.spawn("protocol")
    await fixture.waitForFile()
    const original = await Bun.file(fixture.registration).json()
    await Bun.write(fixture.registration + ".missing-health", "")
    const starts: EnsureReason[] = []
    const error = await client
      .ensure({
        file: fixture.registration,
        version: "2.1.0-next.1",
        command: fixture.command("compatible"),
        onStart: (reason) => starts.push(reason),
      })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) throw error
    expect(error.message).toContain("incompatible health protocol")
    expect(owner.exitCode).toBe(null)
    expect(await Bun.file(fixture.registration + ".signal").exists()).toBe(false)
    expect(await Bun.file(fixture.registration + ".handoff-request").exists()).toBe(false)
    expect(await Bun.file(fixture.registration + ".started").exists()).toBe(false)
    expect(starts).toEqual([])
    expect(await Bun.file(fixture.registration).json()).toEqual(original)
  })

  test(`${client.name} can explicitly stop a protocol-incompatible owner`, async () => {
    await using fixture = await serviceFixture()
    const owner = fixture.spawn("protocol")
    await fixture.waitForFile()
    await Bun.write(fixture.registration + ".missing-health", "")

    await client.stop({ file: fixture.registration })
    expect(await owner.exited).toBe(stoppedExitCode)
    expect(await fixture.signal()).toBe(stopSignal)
    expect(await Bun.file(fixture.registration).exists()).toBe(false)
  })
}

for (const client of clients) {
  test(`${client.name} never adopts or stops an incomplete or foreign registration`, async () => {
    await using fixture = await serviceFixture()
    const url = "http://127.0.0.1:1/"
    const records: ReadonlyArray<unknown> = [
      "not json",
      { url, version: "test", password: "secret" },
      { id: "instance", url, version: "test", password: "secret" },
      { id: "instance", product: "panacode", url, pid: 0, version: "test", password: "secret" },
      { id: "instance", product: "panacode", url, pid: -1, version: "test", password: "secret" },
      { id: "instance", product: "panacode", url, pid: 1.5, version: "test", password: "secret" },
      { id: "instance", product: "panacode", url, pid: "1", version: "test", password: "secret" },
      { id: "instance", product: "opencode", url, pid: 1, version: "test", password: "secret" },
      { id: "instance", product: "panacode", url: "http://example.com/", pid: 1, version: "test", password: "secret" },
    ]

    for (const record of records) {
      const text = typeof record === "string" ? record : JSON.stringify(record)
      await Bun.write(fixture.registration, text)

      expect(await client.discover({ file: fixture.registration })).toBeUndefined()
      await expect(client.stop({ file: fixture.registration })).rejects.toThrow("Refusing to stop")
      expect(await Bun.file(fixture.registration).text()).toBe(text)
    }
  })

  test(`${client.name} does not replace a damaged registration whose endpoint still answers`, async () => {
    await using fixture = await serviceFixture()
    const authorizations: Array<string | null> = []
    const occupied = Bun.serve({
      port: 0,
      fetch: (request) => {
        authorizations.push(request.headers.get("authorization"))
        return new Response("foreign")
      },
    })
    try {
      const text = JSON.stringify({
        id: "claimed-instance",
        url: occupied.url.href,
        pid: 1234,
        version: "test",
        password: "secret",
      })
      await Bun.write(fixture.registration, text)
      const starts: EnsureReason[] = []
      const error = await client
        .ensure({
          file: fixture.registration,
          version: "test",
          command: fixture.command("record-start"),
          onStart: (reason) => starts.push(reason),
        })
        .catch((error: unknown) => error)

      expect(error).toBeInstanceOf(Error)
      if (!(error instanceof Error)) throw error
      expect(error.message).toContain("refusing to reuse or replace it")
      expect(starts).toEqual([])
      expect(await Bun.file(fixture.registration + ".started").exists()).toBe(false)
      expect(await Bun.file(fixture.registration).text()).toBe(text)
      // Occupancy is checked without the private registration credential.
      expect(authorizations.every((value) => value === null)).toBe(true)
    } finally {
      occupied.stop(true)
    }
  })

  test(`${client.name} starts safely over a damaged registration when the port is free`, async () => {
    await using fixture = await serviceFixture()
    const text = JSON.stringify({ url: "http://127.0.0.1:1/", version: "test", password: "secret" })
    await Bun.write(fixture.registration, text)

    const error = await client
      .ensure({ file: fixture.registration, version: "test", command: fixture.command("record-start") })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Error)
    expect(await Bun.file(fixture.registration + ".started").exists()).toBe(true)
    expect(await Bun.file(fixture.registration).text()).toBe(text)
  })
}
