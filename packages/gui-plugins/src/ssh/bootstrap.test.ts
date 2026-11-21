import { expect, test } from "bun:test"
import { Effect, Predicate, Redacted, Sink, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { ChildProcessSpawner } from "effect/process"
import { ExitCode, make as makeSpawner, makeHandle, ProcessId } from "effect/process/ChildProcessSpawner"
import { createHash } from "node:crypto"
import { binaryPath, bootstrap, parseRegistration } from "./bootstrap"
import { parseTarget } from "./command"
import { ManagedCli } from "../managed-cli"
import { RemoteCli } from "./remote-cli"

const target = "linux-x64-baseline"

const version = "2.0.0-beta.1"

const tarball = ManagedCli.tarballUrl(target, version)

const archive = new TextEncoder().encode("ssh archive fixture")

const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`

const metadata = {
  name: ManagedCli.packageName(target),
  version,
  os: ["linux"],
  cpu: ["x64"],
  dist: { tarball, integrity },
}

type RegistrationFixture = {
  product: string
  id: string
  url: string
  password: string
  version: string
  pid: number
}

function registration(overrides: Partial<RegistrationFixture> = {}): RegistrationFixture {
  return {
    id: "instance-1",
    product: "panacode",
    url: "http://127.0.0.1:4321",
    password: "secret",
    version,
    pid: 42,
    ...overrides,
  }
}

function status(value: string) {
  return `OPENCODE_SSH_STATUS=${value}\n`
}

function frame(value: RegistrationFixture) {
  return `OPENCODE_SSH_REGISTRATION_BEGIN\n${JSON.stringify(value)}\nOPENCODE_SSH_REGISTRATION_END\n`
}

test("registration parsing requires the Panacode product, an instance id and the healthy endpoint", () => {
  const valid = registration()
  const text = status(valid.url) + frame(valid)
  expect(parseRegistration(text)).toMatchObject(valid)
  expect(parseRegistration(status("stopped") + frame(valid))).toBeUndefined()
  expect(parseRegistration(status("http://127.0.0.1:9999") + frame(valid))).toBeUndefined()
  expect(parseRegistration(status(valid.url) + frame({ ...valid, product: "opencode" }))).toBeUndefined()
  expect(parseRegistration(status(valid.url) + frame({ ...valid, id: "" }))).toBeUndefined()
  expect(parseRegistration(status(valid.url) + "OPENCODE_SSH_REGISTRATION_BEGIN\ninvalid\nOPENCODE_SSH_REGISTRATION_END\n")).toBeUndefined()

  const ambiguous = status(valid.url) + frame({ ...valid, product: "other" }) + frame(valid)
  expect(parseRegistration(ambiguous)).toMatchObject(valid)
})

test("rejects unsafe versions and platforms in remote installation paths", () => {
  expect(() => binaryPath('2.0.0"; whoami')).toThrow()
  expect(RemoteCli.requireVersion(version)).toBe(version)
  expect(ManagedCli.tarballUrl(target, version)).toBe(tarball)
  expect(() => RemoteCli.installScript({ version: '2.0.0"; whoami', source: { type: "archive", artifact: artifact(), sha256: "0" } })).toThrow()
  expect(() => ManagedCli.requireTarget("linux-x64;whoami")).toThrow()
})

type SshCall = { readonly args: readonly string[]; readonly stdin: Uint8Array }

type SshOutcome = { readonly code?: number; readonly stdout?: string; readonly stderr?: string }

function fakeSsh(outcomes: readonly SshOutcome[]) {
  const queue = [...outcomes]
  const calls: SshCall[] = []

  const spawner = makeSpawner((command) => {
    if (!Predicate.isTagged(command, "StandardCommand")) return Effect.die(new Error("Unexpected piped command"))

    const input = command.options.stdin

    const stream =
      input !== undefined && !Predicate.isString(input) && !Stream.isStream(input) ? input.stream : undefined

    return Effect.gen(function* () {
      const values = Stream.isStream(stream) ? yield* Stream.runCollect(stream) : []
      const stdin = new Uint8Array(values.reduce((size, chunk) => size + chunk.length, 0))
      let offset = 0

      for (const chunk of values) {
        stdin.set(chunk, offset)
        offset += chunk.length
      }

      calls.push({
        args: command.args.map((arg) => (Predicate.isString(arg) ? arg : Redacted.value(arg))),
        stdin,
      })
      const outcome = queue.shift()

      if (!outcome) return yield* Effect.die(new Error(`Unexpected SSH call: ${command.args.join(" ")}`))

      return makeHandle({
        pid: ProcessId(1),
        exitCode: Effect.succeed(ExitCode(outcome.code ?? 0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout: Stream.make(new TextEncoder().encode(outcome.stdout ?? "")),
        stderr: Stream.make(new TextEncoder().encode(outcome.stderr ?? "")),
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      })
    })
  })

  return { spawner, calls }
}

function fakeHttp(routes: Readonly<Record<string, { status: number; body: string }>>) {
  return HttpClient.make((request) =>
    Effect.sync(() => {
      const route = routes[request.url]

      return HttpClientResponse.fromWeb(
        request,
        new Response(route?.body ?? "", {
          status: route?.status ?? 404,
          headers: { "content-type": "application/json" },
        }),
      )
    }),
  )
}

function artifact() {
  return {
    package: metadata.name,
    version,
    target,
    url: tarball,
    sha512: createHash("sha512").update(archive).digest("hex"),
  }
}

function run(outcomes: readonly SshOutcome[], routes: Readonly<Record<string, { status: number; body: string }>> = {}) {
  const { spawner, calls } = fakeSsh(outcomes)

  return {
    calls,
    effect: bootstrap({
      target: parseTarget("devbox"),
      version,
      env: {},
    }).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.provideService(HttpClient.HttpClient, fakeHttp(routes)),
    ),
  }
}

const probe = { stdout: `OPENCODE_REMOTE_TARGET=${target}\n` }

test("SSH downloads the registry artifact and starts the private cache", async () => {
  const { calls, effect } = run(
    [
      probe,
      { stdout: "" },
      {},
      { stdout: status(registration().url) + frame(registration()) },
    ],
    {
      [ManagedCli.metadataUrl(target, version)]: { status: 200, body: JSON.stringify(metadata) },
    },
  )

  expect(await Effect.runPromise(effect)).toEqual({
    host: "127.0.0.1",
    port: 4321,
    password: "secret",
    instance: "instance-1",
  })
  expect(calls).toHaveLength(4)
  expect(new TextDecoder().decode(calls[0]!.stdin)).toContain("uname")
  expect(new TextDecoder().decode(calls[1]!.stdin)).toContain("service status")
  const install = new TextDecoder().decode(calls[2]!.stdin)
  expect(install).toContain(artifact().sha512)
  expect(install).toContain(tarball)
  expect(install).toContain("sha512_of")
  const start = new TextDecoder().decode(calls[3]!.stdin)
  expect(start).toContain(`$HOME/.panacode/desktop-ssh/${version}/panacode`)
  expect(start).toContain("service start")
  expect(start).not.toContain("dev/install")
})

test("SSH relays the verified archive over stdin when the remote cannot download it", async () => {
  const { calls, effect } = run(
    [
      probe,
      { stdout: "" },
      { code: 1, stderr: "curl: (7) Failed to connect" },
      {},
      { stdout: status(registration().url) + frame(registration()) },
    ],
    {
      [ManagedCli.metadataUrl(target, version)]: { status: 200, body: JSON.stringify(metadata) },
      [tarball]: { status: 200, body: new TextDecoder().decode(archive) },
    },
  )

  expect(await Effect.runPromise(effect)).toMatchObject({ port: 4321, instance: "instance-1" })
  expect(calls).toHaveLength(5)
  expect(calls[3]!.args.at(-1)?.startsWith("sh -c ")).toBe(true)
  const relay = calls[3]!.args.at(-1) ?? ""
  expect(relay).toContain("cat > \"$archive\"")
  expect(relay).toContain(ManagedCli.sha256Hex(archive))
  expect(new TextDecoder().decode(calls[3]!.stdin)).toBe(new TextDecoder().decode(archive))
})

test("an unpublished artifact stops before any install or reuse", async () => {
  const { calls, effect } = run([probe, { stdout: "" }], {
    [ManagedCli.metadataUrl(target, version)]: { status: 404, body: "" },
  })

  const error = await Effect.runPromise(Effect.flip(effect))

  expect(error.code).toBe("unpublished")
  expect(calls).toHaveLength(2)
})

test("metadata with a digest that is not sha512 never reaches the remote", async () => {
  const { calls, effect } = run([probe, { stdout: "" }], {
    [ManagedCli.metadataUrl(target, version)]: {
      status: 200,
      body: JSON.stringify({ ...metadata, dist: { ...metadata.dist, integrity: "sha512-abc" } }),
    },
  })

  const error = await Effect.runPromise(Effect.flip(effect))

  expect(error.code).toBe("install")
  expect(calls).toHaveLength(2)
})

test("a verified cache with a mismatched service version needs replace before it restarts", async () => {
  const old = registration({ version: "1.0.0" })
  const discovery = { stdout: `OPENCODE_SSH_CLI=ready\n${status(old.url)}${frame(old)}` }
  const { calls, effect } = run([probe, discovery], {})

  expect((await Effect.runPromise(Effect.flip(effect))).code).toBe("version")
  expect(calls).toHaveLength(2)
})

test("replace restarts a verified cache without downloading again", async () => {
  const old = registration({ version: "1.0.0" })
  const fresh = registration()

  const { spawner, calls } = fakeSsh([
    probe,
    { stdout: `OPENCODE_SSH_CLI=ready\n${status(old.url)}${frame(old)}` },
    { stdout: status(fresh.url) + frame(fresh) },
  ])

  const result = await Effect.runPromise(
    bootstrap({ target: parseTarget("devbox"), version, env: {}, replace: true }).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.provideService(HttpClient.HttpClient, fakeHttp({})),
    ),
  )

  expect(result.instance).toBe("instance-1")
  expect(calls).toHaveLength(3)
  expect(new TextDecoder().decode(calls[2]!.stdin)).toContain("service restart")
})