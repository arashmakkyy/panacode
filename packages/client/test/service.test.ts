import { NodeFileSystem } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect, FileSystem } from "effect"
import { writeFile } from "node:fs/promises"
import { Service, type EnsureDiagnostic, type EnsureReason } from "../src/effect/service"
import { withEnsureTiming } from "../src/service-timing"
import {
  serviceFixture,
  stopSignal,
  stoppedExitCode,
} from "./fixture/service-fixture"
import { accelerate } from "./fixture/service-timing"

const ensure = accelerate(Service.ensure)
const stop = accelerate(Service.stop)

test("a concurrent same-version start cannot invalidate a resolved endpoint", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  fixture.spawn("modern")
  await fixture.waitForFile()
  const original = await Bun.file(registration).json()

  const starts: EnsureReason[] = []
  const first = run(
    ensure({
      file: registration,
      version: "test",
      command: [],
      onStart: (reason) => starts.push(reason),
    }),
  )
  await fixture.waitForFile(registration + ".first-request")

  const resolved = await run(ensure({ file: registration, version: "test" }))
  expect(resolved.url).toBe(original.url)

  await writeFile(registration + ".release", "")
  await first

  expect(starts).toEqual([])
  expect(await Bun.file(registration).json()).toEqual(original)
  expect(await status(resolved.url)).toMatchObject({ version: "test", pid: original.pid })
})

test("reuses a compatible registered service", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const existing = fixture.spawn("compatible")
  await fixture.waitForFile()

  const starts: EnsureReason[] = []
  const endpoint = await run(
    ensure({
      file: registration,
      version: (version) => version.startsWith("2."),
      command: [],
      onStart: (reason) => starts.push(reason),
    }),
  )

  expect(endpoint.url).toBe((await Bun.file(registration).json()).url)
  expect(starts).toEqual([])
  expect(existing.exitCode).toBe(null)
})

test("adds configured environment variables when starting a service", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const endpoint = await run(
    ensure({
      file: registration,
      version: "test",
      command: fixture.command("environment"),
      env: { PANACODE_SERVICE_ENV_TEST: "configured" },
    }),
  )
  const info = await Bun.file(registration).json()
  fixture.track(info.pid)

  expect(endpoint.url).toBe(info.url)
  expect(await Bun.file(registration + ".environment").text()).toBe("configured")
})

test("replaces an incompatible registered service", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const existing = fixture.spawn("incompatible")
  await fixture.waitForFile()

  const starts: EnsureReason[] = []
  const endpoint = await run(
    ensure({
      file: registration,
      version: (version) => version.startsWith("2."),
      command: fixture.command("delayed-compatible", "10"),
      onStart: (reason) => starts.push(reason),
    }),
  )
  const replacement = await Bun.file(registration).json()
  fixture.track(replacement.pid)

  expect(await existing.exited).toBe(stoppedExitCode)
  expect(replacement.version).toBe("2.1.0-next.1")
  expect(endpoint.url).toBe(replacement.url)
  expect(starts).toEqual(["version-mismatch"])
})

test("waits for a registered service to finish starting", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const process = fixture.spawn("starting")
  await fixture.waitForFile()
  const result = run(ensure({ file: registration, version: "test", command: [] }))

  await fixture.waitForFile(registration + ".status-request")
  expect(process.exitCode).toBe(null)
  await writeFile(registration + ".release", "")
  expect((await result).url).toBe((await Bun.file(registration).json()).url)
})

test("recovers when the starting service it waits for is stopped", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const starting = fixture.spawn("starting")
  await fixture.waitForFile()
  const result = run(ensure({ file: registration, version: "test", command: fixture.command("delayed", "10") }))

  await fixture.waitForFile(registration + ".status-request")
  await run(stop({ file: registration }))
  const endpoint = await result
  const replacement = await Bun.file(registration).json()
  fixture.track(replacement.pid)

  expect(await starting.exited).toBe(stoppedExitCode)
  expect(replacement.pid).not.toBe(starting.pid)
  expect(endpoint.url).toBe(replacement.url)
})

test("replaces a crashed service whose registration names a dead process", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const crashed = fixture.spawn("graceful")
  await fixture.waitForFile()
  crashed.kill("SIGKILL")
  await crashed.exited

  const starts: EnsureReason[] = []
  const endpoint = await run(
    ensure({
      file: registration,
      version: "test",
      command: fixture.command("delayed", "10"),
      onStart: (reason) => starts.push(reason),
    }),
  )
  const replacement = await Bun.file(registration).json()
  fixture.track(replacement.pid)

  expect(replacement.pid).not.toBe(crashed.pid)
  expect(endpoint.url).toBe(replacement.url)
  expect(starts).toEqual(["missing"])
})

test("reports a failed registered service without spawning", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const process = fixture.spawn("failed-owner")
  await fixture.waitForFile()

  await expect(run(ensure({ file: registration, version: "test", command: [] }))).rejects.toThrow(
    "Background service failed to start",
  )
  expect(process.exitCode).toBe(null)
})

test("evicts an unresponsive registered service before starting its replacement", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const existing = fixture.spawn("hanging")
  await fixture.waitForFile()
  const original = await Bun.file(registration).json()

  const endpoint = await run(
    ensure({
      file: registration,
      version: "test",
      command: fixture.command("delayed", "10"),
    }),
  )
  const replacement = await Bun.file(registration).json()
  fixture.track(replacement.pid)

  expect((await Bun.file(registration + ".requests").text()).trim().split("\n")).toHaveLength(3)
  expect(await existing.exited).toBe(stoppedExitCode)
  expect(replacement.pid).not.toBe(original.pid)
  expect(endpoint.url).toBe(replacement.url)
  expect(await status(endpoint.url)).toMatchObject({ version: "test", pid: replacement.pid })
})

test("shuts down an unresponsive registered service over the private control channel", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const process = fixture.spawn("hanging")
  await fixture.waitForFile()

  await run(Service.stop({ file: registration }))
  await process.exited
  expect(await fixture.signal()).toBe(stopSignal)
  expect(await Bun.file(registration).exists()).toBe(false)
})

test("stop leaves a service that ignores authenticated shutdown running and reports it", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const existing = fixture.spawn("lingering", "5000")
  await fixture.waitForFile()
  const original = await Bun.file(registration).json()

  await expect(run(stop({ file: registration }))).rejects.toThrow(
    `Server process ${original.pid} did not stop after an authenticated shutdown request`,
  )

  expect(await fixture.signal()).toBe(stopSignal)
  expect(() => process.kill(original.pid, 0)).not.toThrow()
  expect(await Bun.file(registration).exists()).toBe(false)
  existing.kill("SIGKILL")
  await existing.exited
}, 15_000)

test.skipIf(process.platform === "win32")(
  "stop reports a process that survives the shutdown request",
  async () => {
    await using fixture = await serviceFixture()
    const registration = fixture.registration
    fixture.spawnUnreaped("lingering", "60000")
    await fixture.waitForFile()
    const original = await Bun.file(registration).json()

    await expect(run(stop({ file: registration }))).rejects.toThrow(
      `Server process ${original.pid} did not stop after an authenticated shutdown request`,
    )
    expect(await Bun.file(registration + ".signal").text()).toBe(stopSignal)
  },
  15_000,
)

// The control channel decides when the original exits, so a successor can register while the
// original is still winding down. Stopping A must never delete B's registration.
test("stop waits for the original process while preserving a newly registered successor", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const existing = fixture.spawn("lingering", "15000")
  await fixture.waitForFile()
  const original = await Bun.file(registration).json()
  const stopping = run(Service.stop({ file: registration })).catch((error: unknown) => error)

  try {
    await fixture.waitForFile(registration + ".unregistered")
    const successor = fixture.spawn("graceful")
    await fixture.waitForFile()
    const replacement = await Bun.file(registration).json()
    expect(existing.exitCode).toBe(null)
    expect(replacement.pid).toBe(successor.pid)

    const error = await stopping
    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) throw error
    expect(error.message).toContain("did not stop after an authenticated shutdown request")

    expect(() => process.kill(original.pid, 0)).not.toThrow()
    expect(await Bun.file(registration).json()).toEqual(replacement)
    expect(await status(replacement.url)).toMatchObject({ pid: successor.pid, instance: replacement.id })
    expect(successor.exitCode).toBe(null)
  } finally {
    existing.kill("SIGKILL")
    await existing.exited
    await stopping
  }
}, 20_000)

test("signals an incompatible service before starting its replacement", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const existing = fixture.spawn("old")
  await fixture.waitForFile()
  const endpoint = await run(
    ensure({
      file: registration,
      version: "test",
      command: fixture.command("delayed", "10"),
    }),
  )
  const replacement = await Bun.file(registration).json()
  fixture.track(replacement.pid)

  expect(await existing.exited).toBe(stoppedExitCode)
  expect(endpoint.url).toBe(replacement.url)
})

test("waits for a slow winner while bounding lock probes", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const endpoint = await run(
    ensure({
      file: registration,
      version: "test",
      command: fixture.command("coordinated"),
    }),
  )
  const info = await Bun.file(registration).json()
  fixture.track(info.pid)

  expect(endpoint.url).toBe(info.url)
  expect(await status(endpoint.url)).toMatchObject({ version: "test", pid: info.pid })
  expect((await Bun.file(registration + ".starts").text()).trim().split("\n")).toHaveLength(2)
})

test("waits for a live contender when another contender fails", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const endpoint = await run(
    ensure({
      file: registration,
      version: "test",
      command: fixture.command("coordinated-failed-loser", "300"),
    }),
  )
  const info = await Bun.file(registration).json()
  fixture.track(info.pid)

  expect(endpoint.url).toBe(info.url)
})

test("reports a contender that fails to start", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  await expect(
    run(
      ensure({
        file: registration,
        version: "test",
        command: fixture.command("failed"),
      }),
    ),
  ).rejects.toThrow("Server process exited with code 1")
})

test("reports overlapping contender failures without recruiting replacements", async () => {
  await using fixture = await serviceFixture()
  const started = Date.now()
  const pending = run(
    ensure({ file: fixture.registration, version: "test", command: fixture.command("controlled") }),
  ).catch((error: unknown) => error)
  const [first, second] = await fixture.waitForStarts(2)
  await fixture.release(first, "fail")
  // Let discovery observe the exit across two accelerated spawn windows before the survivor exits.
  await Bun.sleep(450)
  await fixture.release(second, "fail")
  const error = await pending

  expect(Date.now() - started).toBeLessThan(3_000)
  expect(error).toBeInstanceOf(Error)
  if (!(error instanceof Error)) throw error
  expect(error.message).toContain("Server process exited with code 23")
  expect(error.message).toContain("storage initialization denied")
  expect(await fixture.starts()).toHaveLength(2)
})

test("retains a contender failure until the deadline while its survivor stalls", async () => {
  await using fixture = await serviceFixture()
  const started = Date.now()
  const pending = run(
    ensure({ file: fixture.registration, version: "test", command: fixture.command("controlled") }),
  ).catch((error: unknown) => error)
  const [first, second] = await fixture.waitForStarts(2)
  await fixture.release(first, "fail")
  const error = await pending

  expect(Date.now() - started).toBeGreaterThanOrEqual(3_000)
  expect(error).toBeInstanceOf(Error)
  if (!(error instanceof Error)) throw error
  expect(error.message).toContain("Server process exited with code 23")
  expect(error.message).toContain("storage initialization denied")
  expect(await fixture.starts()).toHaveLength(2)
  expect(() => process.kill(second, 0)).not.toThrow()
})

test("accepts a surviving contender after a failure without recruiting replacements", async () => {
  await using fixture = await serviceFixture()
  const pending = run(ensure({ file: fixture.registration, version: "test", command: fixture.command("controlled") }))
  const [first, second] = await fixture.waitForStarts(2)
  await fixture.release(first, "fail")
  await Bun.sleep(450)
  await fixture.release(second, "ready")
  const endpoint = await pending

  expect((await run(Service.discover({ file: fixture.registration, version: "test" })))?.url).toBe(endpoint.url)
  expect((await Bun.file(fixture.registration).json()).pid).toBe(second)
  expect(await fixture.starts()).toHaveLength(2)
})

test("recovers when an unresponsive contender is evicted after a prior failure", async () => {
  await using fixture = await serviceFixture()
  const pending = run(ensure({ file: fixture.registration, version: "test", command: fixture.command("controlled") }))
  const [first, second] = await fixture.waitForStarts(2)
  await fixture.release(second, "hang")
  await fixture.waitForFile()
  await fixture.release(first, "fail")
  const [, , third] = await fixture.waitForStarts(3)
  await fixture.release(third, "ready")
  const endpoint = await pending
  fixture.track(third)

  expect((await run(Service.discover({ file: fixture.registration, version: "test" })))?.url).toBe(endpoint.url)
  expect((await Bun.file(fixture.registration).json()).pid).toBe(third)
})

test("reports a bounded contender stderr tail", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const error = await run(
    Service.ensure({
      file: registration,
      version: "test",
      command: fixture.command("stderr-failed"),
    }),
  ).catch((error: unknown) => error)

  expect(error).toBeInstanceOf(Error)
  if (!(error instanceof Error)) throw error
  expect(error.message).toContain("actionable startup failure")
  expect(error.message.length).toBeLessThan(9_000)
}, 10_000)

test("reports a monotonic, path-free boot record", async () => {
  await using fixture = await serviceFixture()
  const diagnostics: EnsureDiagnostic[] = []
  const endpoint = await run(
    ensure({
      file: fixture.registration,
      version: (version) => version.startsWith("2."),
      command: fixture.command("delayed-compatible", "10"),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    }),
  )
  const info = await Bun.file(fixture.registration).json()
  fixture.track(info.pid)

  expect(endpoint.url).toBe(info.url)
  expect(diagnostics.map((diagnostic) => diagnostic.stage)).toEqual(["spawn", "register", "health", "ready"])
  expect(diagnostics.map((diagnostic) => diagnostic.elapsed)).toEqual(
    [...diagnostics.map((diagnostic) => diagnostic.elapsed)].sort((left, right) => left - right),
  )
  expect(diagnostics[0]?.pid).toBe(info.pid)
  expect(diagnostics.at(-1)).toMatchObject({ stage: "ready", pid: info.pid })
  expect(JSON.stringify(diagnostics)).not.toContain(fixture.directory)
  expect(JSON.stringify(diagnostics)).not.toContain(info.password)
})

test("reports a sanitized exit reason", async () => {
  await using fixture = await serviceFixture()
  const diagnostics: EnsureDiagnostic[] = []
  const error = await run(
    ensure({
      file: fixture.registration,
      version: "test",
      command: fixture.command("stderr-secrets"),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    }),
  ).catch((error: unknown) => error)

  expect(error).toBeInstanceOf(Error)
  if (!(error instanceof Error)) throw error
  expect(error.message).not.toContain("service-password")
  expect(error.message).not.toContain("control-token")
  expect(error.message).not.toContain("dXNlcjpwYXNz")
  expect(diagnostics.at(-1)).toMatchObject({ stage: "exit", reason: "Server process exited with code 1" })
  expect(JSON.stringify(diagnostics)).not.toContain(fixture.directory)
})

test("reports a startup timeout without the registration path", async () => {
  await using fixture = await serviceFixture()
  const error = await run(
    Service.ensure(
      withEnsureTiming(
        {
          file: fixture.registration,
          version: "test",
          command: fixture.command("controlled"),
        },
        { promiseTimeout: 300, spawnDelay: 50, requestTimeout: 50 },
      ),
    ),
  ).catch((error: unknown) => error)

  expect(error).toBeInstanceOf(Error)
  if (!(error instanceof Error)) throw error
  expect(error.message).toContain("No ready service registered in the Panacode state directory")
  expect(error.message).not.toContain(fixture.directory)
}, 10_000)

test("reports a contender terminated by a signal", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  await expect(
    run(
      ensure({
        file: registration,
        version: "test",
        command: fixture.command("signal"),
      }),
    ),
  ).rejects.toThrow(/Server process (terminated by|exited with code)/)
})

test("reports a slow contender that eventually fails", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  await expect(
    run(
      ensure({
        file: registration,
        version: "test",
        command: fixture.command("delayed-failed", "500"),
      }),
    ),
  ).rejects.toThrow("Server process exited with code 1")
})

test("replaces an incompatible owner that appears during startup", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const starting = run(
    ensure({
      file: registration,
      version: "test",
      command: fixture.command("delayed", "500"),
    }),
  )
  await fixture.waitForFile(registration + ".starts")
  const old = fixture.spawn("old")
  await fixture.waitForFile()
  const endpoint = await starting
  const info = await Bun.file(registration).json()
  fixture.track(info.pid)

  expect(endpoint.url).toBe(info.url)
  expect(info.version).toBe("test")
  await old.exited
})

function run<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)))
}

async function status(url: string) {
  return fetch(new URL("/api/info", url), { signal: AbortSignal.timeout(1_000) }).then((response) => response.json())
}
