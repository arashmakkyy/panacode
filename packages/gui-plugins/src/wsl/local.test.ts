import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Schema } from "effect"
import { stageLocalCli } from "./local"
import { discoverScript, installScript, quote } from "./remote-cli"

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

const shellTools =
  bash !== undefined &&
  Bun.spawnSync(
    [bash, "-c", "command -v tar && (command -v sha256sum || command -v shasum) && (command -v curl || command -v wget)"],
    { stdout: "ignore", stderr: "ignore" },
  ).exitCode === 0

function elf(machine: number) {
  const bytes = new Uint8Array(64)
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])
  bytes[0x12] = machine & 0xff
  bytes[0x13] = machine >> 8
  bytes.set([1, 2, 3, 4], 20)

  return bytes
}

async function linuxDist(
  overrides: { name?: string; version?: string; cpu?: string; machine?: number; bytes?: Uint8Array; missing?: boolean } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "panacode-wsl-dist-"))
  const directory = path.join(root, "dist")
  const name = overrides.name ?? `@panacode/cli-${target}`
  const bytes = overrides.bytes ?? elf(overrides.machine ?? 0x3e)
  const folder = path.join(directory, `cli-${target}`)
  await mkdir(path.join(folder, "bin"), { recursive: true })
  await writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name,
      version: overrides.version ?? version,
      os: ["linux"],
      cpu: [overrides.cpu ?? "x64"],
    }),
  )

  if (!overrides.missing) await writeFile(path.join(folder, "bin", "panacode"), bytes)

  return {
    root,
    directory,
    folder,
    bytes,
    async [Symbol.asyncDispose]() {
      await rm(root, { recursive: true, force: true })
    },
  }
}

test("a real Linux dist stages bin/panacode and hashes the copied bytes", async () => {
  await using dist = await linuxDist()
  const output = path.join(dist.root, "staged cli", "panacode")
  const result = await stageLocalCli({ directory: dist.directory, target, version, output })

  expect(result).toEqual({
    binary: output,
    version,
    target,
    sha256: createHash("sha256").update(dist.bytes).digest("hex"),
  })
  expect([...new Uint8Array(await readFile(output))]).toEqual([...dist.bytes])
})

test("a foreign, mismatched, missing or empty build never replaces the staging file", async () => {
  const cases = [
    await linuxDist({ name: "@opencode/cli-linux-x64-baseline" }),
    await linuxDist({ version: "1.0.0" }),
    await linuxDist({ cpu: "arm64" }),
    await linuxDist({ machine: 0xb7 }),
    await linuxDist({ bytes: new TextEncoder().encode("not an elf") }),
    await linuxDist({ bytes: new Uint8Array() }),
    await linuxDist({ missing: true }),
  ]

  try {
    for (const dist of cases) {
      const output = path.join(dist.root, "staged cli", "panacode")
      await mkdir(path.dirname(output), { recursive: true })
      await writeFile(output, "previous")
      await expect(stageLocalCli({ directory: dist.directory, target, version, output })).rejects.toThrow()
      expect(await readFile(output, "utf8")).toBe("previous")
    }
  } finally {
    await Promise.all(cases.map((dist) => dist[Symbol.asyncDispose]()))
  }
})

test.skipIf(!shellTools)(
  "the local install copies the staged Linux CLI into the private WSL directory without network or PATH reuse",
  async () => {
    await using dist = await linuxDist()
    await using shell = await shellFixture("home with space")
    const output = path.join(dist.root, "staged cli", "panacode")
    const built = await stageLocalCli({ directory: dist.directory, target, version, output })
    const before = await profileHashes(shell.home)

    const result = runShell(installScript({ version, target, source: { kind: "local", binary: output, sha256: built.sha256 } }), shell)
    expect(result.code, result.stderr).toBe(0)

    const installed = path.join(shell.home, ".panacode", "bin", "panacode")
    expect(new Uint8Array(await readFile(installed))).toEqual(await readFile(output))
    expect(JSON.parse(await readFile(path.join(shell.home, ".panacode", "bin", "panacode.artifact.json"), "utf8"))).toMatchObject({
      product: "panacode",
      version,
      target,
      sha256: built.sha256,
    })
    expect(existsSync(shell.counter)).toBe(false)
    expect(await profileHashes(shell.home)).toEqual(before)

    const discovered = runShell(discoverScript(), shell)
    expect(discovered.code, discovered.stderr).toBe(0)
    expect(discovered.stdout.trim().endsWith("/.panacode/bin/panacode")).toBe(true)
  },
  120_000,
)

test.skipIf(!shellTools)(
  "a bad digest, a missing source and a live installer leave the previous WSL CLI untouched",
  async () => {
    await using dist = await linuxDist()
    await using shell = await shellFixture("recovery")
    const output = path.join(dist.root, "staged cli", "panacode")
    const built = await stageLocalCli({ directory: dist.directory, target, version, output })
    const good = installScript({ version, target, source: { kind: "local", binary: output, sha256: built.sha256 } })
    expect(runShell(good, shell).code).toBe(0)
    const installed = path.join(shell.home, ".panacode", "bin", "panacode")
    const bytes = await readFile(installed)

    const badDigest = runShell(
      installScript({ version, target, source: { kind: "local", binary: output, sha256: "0".repeat(64) } }),
      shell,
    )

    expect(badDigest.code).not.toBe(0)
    expect(await readFile(installed)).toEqual(bytes)

    const missing = runShell(
      installScript({ version, target, source: { kind: "local", binary: path.join(shell.root, "missing"), sha256: built.sha256 } }),
      shell,
    )

    expect(missing.code).not.toBe(0)
    expect(await readFile(installed)).toEqual(bytes)

    const liveLock = runShell(
      `mkdir -p "$HOME/.panacode/bin/.install.lock"\nprintf '%s\\n' "$$" > "$HOME/.panacode/bin/.install.lock/pid"\n${good}`,
      shell,
    )

    expect(liveLock.code).not.toBe(0)
    expect(liveLock.stderr).toContain("Another Panacode CLI install is already running.")
    expect(await readFile(installed)).toEqual(bytes)

    const stale = path.join(shell.home, ".panacode", "bin", ".install.lock")
    await writeFile(path.join(stale, "pid"), "999999")
    expect(runShell(good, shell).code).toBe(0)
    expect(await readFile(installed)).toEqual(bytes)
  },
  120_000,
)

test.skipIf(!shellTools)(
  "a version-only, foreign, stale or modified WSL cache is not discovered",
  async () => {
    await using dist = await linuxDist()
    await using shell = await shellFixture("discovery")
    const output = path.join(dist.root, "staged cli", "panacode")
    const built = await stageLocalCli({ directory: dist.directory, target, version, output })
    expect(runShell(installScript({ version, target, source: { kind: "local", binary: output, sha256: built.sha256 } }), shell).code).toBe(0)

    const metadata = path.join(shell.home, ".panacode", "bin", "panacode.artifact.json")
    const sidecar = Schema.decodeUnknownSync(Sidecar)(await readFile(metadata, "utf8"))
    const discovered = () => runShell(discoverScript(), shell).stdout.trim()

    expect(discovered().endsWith("/.panacode/bin/panacode")).toBe(true)

    await writeFile(metadata, JSON.stringify({ product: "opencode", version, target, sha256: sidecar.sha256 }))
    expect(discovered()).toBe("")

    await writeFile(metadata, JSON.stringify({ product: "panacode", version }))
    expect(discovered()).toBe("")

    await writeFile(metadata, JSON.stringify({ product: "panacode", version, target, sha256: "0".repeat(64) }))
    expect(discovered()).toBe("")

    await writeFile(metadata, JSON.stringify({ product: "panacode", version, target, sha256: sidecar.sha256 }))
    const installed = path.join(shell.home, ".panacode", "bin", "panacode")
    await writeFile(installed, Buffer.concat([await readFile(installed), Buffer.from("x")]))
    expect(discovered()).toBe("")
  },
  120_000,
)

type ShellFixture = {
  readonly root: string
  readonly home: string
  readonly bin: string
  readonly counter: string
  readonly [Symbol.asyncDispose]: () => Promise<void>
}

async function shellFixture(label: string): Promise<ShellFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "panacode-wsl-shell-"))
  const home = path.join(root, label)
  const bin = path.join(root, "bin")
  const counter = path.join(root, "opencode-ran")
  await mkdir(home, { recursive: true })
  await mkdir(bin, { recursive: true })

  const counted = path.join(bin, "opencode")
  await writeFile(counted, `#!/bin/sh\nprintf x >> ${quote(shellHome(counter))}\n`)
  await chmod(counted, 0o755)
  const foreign = path.join(home, ".opencode", "bin", "opencode")
  await mkdir(path.dirname(foreign), { recursive: true })
  await writeFile(foreign, "#!/bin/sh\nexit 0\n")
  await chmod(foreign, 0o755)
  const wslpath = path.join(bin, "wslpath")
  await writeFile(wslpath, '#!/bin/sh\n[ "$1" = "-a" ] && shift\ncygpath -u "$1"\n')
  await chmod(wslpath, 0o755)
  await writeFile(path.join(home, ".bashrc"), "# user\n")
  await writeFile(path.join(home, ".profile"), "# user profile\n")

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

function runShell(script: string, fixture: Pick<ShellFixture, "home" | "bin">, stdin?: Uint8Array) {
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

async function profileHashes(home: string) {
  return Promise.all(
    [".bashrc", ".profile", path.join(".opencode", "bin", "opencode")].map(async (file) =>
      createHash("sha256")
        .update(await readFile(path.join(home, file)))
        .digest("hex"),
    ),
  )
}

// The WSL installer runs under a POSIX shell, so paths passed to it use that shell's notation.
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