import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Schema } from "effect"
import { discoverScript, installScript } from "./remote-cli"

const Sidecar = Schema.fromJsonString(
  Schema.Struct({
    product: Schema.String,
    version: Schema.String,
    target: Schema.String,
    sha256: Schema.String,
  }),
)

const target = "linux-x64-baseline"

const version = "2.0.0-beta.1"

const bash = findBash() ?? undefined

const tar = Bun.which("tar") ?? undefined

const shellTools =
  bash !== undefined &&
  tar !== undefined &&
  Bun.spawnSync(
    [bash, "-c", "command -v tar && (command -v sha256sum || command -v shasum) && (command -v curl || command -v wget)"],
    { stdout: "ignore", stderr: "ignore" },
  ).exitCode === 0

function artifact(url: string, bytes: Uint8Array) {
  return {
    package: `@panacode/cli-${target}`,
    version,
    target,
    url,
    sha512: createHash("sha512").update(bytes).digest("hex"),
  }
}

async function cache(label: string) {
  const root = await mkdtemp(path.join(tmpdir(), "panacode-ssh-"))
  const home = path.join(root, label)
  const bin = path.join(root, "bin")
  const counter = path.join(root, "opencode-ran")
  await mkdir(home, { recursive: true })
  await mkdir(bin, { recursive: true })
  await writeFile(path.join(bin, "opencode"), `#!/bin/sh\nprintf x >> '${shellHome(counter)}'\n`)
  await chmod(path.join(bin, "opencode"), 0o755)

  return {
    root,
    home,
    bin,
    counter,
    async [Symbol.asyncDispose]() {
      await rm(root, { recursive: true, force: true })
    },
  }
}

async function archiveFixture(root: string) {
  const workspace = path.join(root, "workspace")
  const binary = path.join(workspace, "package", "bin", "panacode")
  await mkdir(path.dirname(binary), { recursive: true })
  const bytes = new TextEncoder().encode("#!/bin/sh\nexit 0\n")
  await writeFile(binary, bytes)
  const archive = path.join(workspace, "cli.tgz")

  const built = Bun.spawnSync({
    // Keep every operand relative: GNU tar reads `C:\...` as a remote host:path.
    cmd: [tar!, "-czf", "cli.tgz", "package/bin/panacode"],
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
  })

  expect(built.exitCode, built.stderr.toString()).toBe(0)

  return { archive, bytes: new Uint8Array(await readFile(archive)), binary: bytes }
}

function fileUrl(file: string) {
  if (process.platform !== "win32") return `file://${file}`

  return `file:///${path.resolve(file).replaceAll("\\", "/")}`
}

function run(script: string, fixture: { home: string; bin: string }, stdin?: Uint8Array) {
  const result = Bun.spawnSync({
    cmd: [bash!, "-c", script],
    env: {
      HOME: shellHome(fixture.home),
      PATH: `${shellHome(fixture.bin)}:/usr/bin:/bin`,
      SYSTEMROOT: process.env.SYSTEMROOT,
      WINDIR: process.env.WINDIR,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
    },
    stdin,
    stdout: "pipe",
    stderr: "pipe",
  })

  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() }
}

function paths(home: string) {
  const directory = path.join(home, ".panacode", "desktop-ssh-v2", version)

  return { directory, binary: path.join(directory, "panacode." + createHash("sha256").update("#!/bin/sh\nexit 0\n").digest("hex")), metadata: path.join(directory, "panacode.artifact.json") }
}

async function install(source: "download" | "relay", file: string, fixture: { home: string; bin: string }, digest?: Uint8Array) {
  const bytes = digest ?? new Uint8Array(await readFile(file))
  const url = source === "download" ? fileUrl(file) : "https://registry.npmjs.org/panacode.tgz"

  const script =
    source === "download"
      ? installScript({ version, source: { type: "download", artifact: artifact(url, bytes) } })
      : installScript({
          version,
          source: { type: "archive", artifact: artifact(url, bytes), sha256: createHash("sha256").update(bytes).digest("hex") },
        })

  return source === "download" ? run(script, fixture) : run(script, fixture, bytes)
}

test.skipIf(!shellTools)(
  "SSH download and stdin relay install the verified archive into the private cache",
  async () => {
    await using fixture = await cache("download")
    const archive = await archiveFixture(fixture.root)
    const first = await install("download", archive.archive, fixture)
    expect(first.code, first.stderr).toBe(0)
    const expected = paths(fixture.home).binary
    expect(new Uint8Array(await readFile(expected))).toEqual(archive.binary)
    expect(JSON.parse(await readFile(paths(fixture.home).metadata, "utf8"))).toMatchObject({
      product: "panacode",
      version,
      target,
      sha256: createHash("sha256").update(archive.binary).digest("hex"),
    })
    expect(existsSync(fixture.counter)).toBe(false)
    expect(run(discoverScript({ version, target }), fixture).stdout).toContain("OPENCODE_SSH_CLI=ready")

    await rm(paths(fixture.home).directory, { recursive: true, force: true })
    const relay = await install("relay", archive.archive, fixture)
    expect(relay.code, relay.stderr).toBe(0)
    expect(new Uint8Array(await readFile(expected))).toEqual(archive.binary)
  },
  120_000,
)

test.skipIf(!shellTools)(
  "SSH rejects a bad digest, a missing asset and an incomplete relay before replacing a healthy cache",
  async () => {
    await using fixture = await cache("recovery")
    const archive = await archiveFixture(fixture.root)
    expect((await install("download", archive.archive, fixture)).code).toBe(0)
    const { binary, metadata } = paths(fixture.home)
    const healthy = await readFile(binary)
    const healthyMetadata = await readFile(metadata)

    const wrongDigest = run(
      installScript({
        version,
        source: {
          type: "download",
          artifact: artifact(fileUrl(archive.archive), new TextEncoder().encode("another archive")),
        },
      }),
      fixture,
    )

    expect(wrongDigest.code).not.toBe(0)
    expect(await readFile(binary)).toEqual(healthy)

    const missing = run(
      installScript({
        version,
        source: { type: "download", artifact: artifact(fileUrl(path.join(fixture.root, "missing.tgz")), archive.bytes) },
      }),
      fixture,
    )

    expect(missing.code).not.toBe(0)
    expect(await readFile(binary)).toEqual(healthy)

    const truncated = archive.bytes.subarray(0, 24)

    const incomplete = run(
      installScript({
        version,
        source: {
          type: "archive",
          artifact: artifact("https://registry.npmjs.org/panacode.tgz", archive.bytes),
          sha256: createHash("sha256").update(archive.bytes).digest("hex"),
        },
      }),
      fixture,
      truncated,
    )

    expect(incomplete.code).not.toBe(0)
    expect(await readFile(binary)).toEqual(healthy)
    expect(await readFile(metadata)).toEqual(healthyMetadata)
  },
  120_000,
)

test.skipIf(!shellTools)(
  "SSH discovers only a sidecar that names the same version, target and digest",
  async () => {
    await using fixture = await cache("discovery")
    const archive = await archiveFixture(fixture.root)
    expect((await install("download", archive.archive, fixture)).code).toBe(0)
    const { binary, metadata } = paths(fixture.home)
    const sidecar = Schema.decodeUnknownSync(Sidecar)(await readFile(metadata, "utf8"))
    const discovered = () => run(discoverScript({ version, target }), fixture).stdout

    expect(discovered()).toContain("OPENCODE_SSH_CLI=ready")

    await writeFile(metadata, JSON.stringify({ product: "panacode", version }))
    expect(discovered()).not.toContain("OPENCODE_SSH_CLI=ready")

    await writeFile(metadata, JSON.stringify({ product: "panacode", version, target: "linux-arm64", sha256: sidecar.sha256 }))
    expect(discovered()).not.toContain("OPENCODE_SSH_CLI=ready")

    await writeFile(metadata, JSON.stringify({ product: "panacode", version, target, sha256: "0".repeat(64) }))
    expect(discovered()).not.toContain("OPENCODE_SSH_CLI=ready")

    await writeFile(metadata, JSON.stringify({ product: "panacode", version, target, sha256: sidecar.sha256 }))
    await writeFile(binary, Buffer.concat([await readFile(binary), Buffer.from("x")]))
    expect(discovered()).not.toContain("OPENCODE_SSH_CLI=ready")
  },
  120_000,
)

test.skipIf(!shellTools)(
  "concurrent SSH publishers leave a complete usable generation",
  async () => {
    await using fixture = await cache("lock")
    const archive = await archiveFixture(fixture.root)
    expect((await install("download", archive.archive, fixture)).code).toBe(0)
    const { binary } = paths(fixture.home)
    const healthy = await readFile(binary)

    const script = installScript({
      version,
      source: { type: "download", artifact: artifact(fileUrl(archive.archive), archive.bytes) },
    })

    const parallel = run(`(
${script}
) &
first=$!
(
${script}
) &
second=$!
wait "$first" && wait "$second"`, fixture)
    expect(parallel.code, parallel.stderr).toBe(0)
    expect(await readFile(binary)).toEqual(healthy)
    expect(run(discoverScript({ version, target }), fixture).stdout).toContain("OPENCODE_SSH_CLI=ready")
  },
  120_000,
)

// The installer runs under a POSIX shell, so paths passed to it use that shell's notation.
function shellHome(native: string) {
  if (process.platform !== "win32") return native
  const forward = native.replaceAll("\\", "/")

  return /^[A-Za-z]:\//.test(forward) ? `/${forward[0]!.toLowerCase()}${forward.slice(2)}` : forward
}

// Windows ships a WSL bash on PATH, which cannot see the fixture's Windows home. Prefer the
// Git-for-Windows bash that owns the checkout and reports a MINGW/MSYS/CYGWIN kernel.
function findBash() {
  if (process.platform !== "win32") return Bun.which("bash")
  const git = Bun.which("git")

  const candidates = [
    git ? path.resolve(path.dirname(git), "..", "bin", "bash.exe") : undefined,
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ]

  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue
    const probe = Bun.spawnSync({ cmd: [candidate, "-c", "uname -s"], stdout: "pipe", stderr: "ignore" })

    if (/MINGW|MSYS|CYGWIN/.test(probe.stdout.toString())) return candidate
  }

  return undefined
}