import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFile, mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { Option, Schema } from "effect"
import { ManagedCli } from "../managed-cli"

const execFileAsync = promisify(execFile)

const Manifest = Schema.Struct({
  name: Schema.NonEmptyString,
  version: Schema.NonEmptyString,
  os: Schema.Array(Schema.String),
  cpu: Schema.Array(Schema.String),
})

const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(Manifest))

export type LocalWslCli = {
  readonly binary: string
  readonly version: string
  readonly target: string
  readonly sha256: string
}

/**
 * Development only: builds the Linux CLI for one WSL target from this checkout.
 * `OPENCODE_TARGET` selects the dist directory so the staged bytes match the
 * distro instead of the Windows host.
 */
export async function buildLocalWslCli(input: { version: string; script: string; output: string; target: string }) {
  const directory = await mkdtemp(join(tmpdir(), "panacode-wsl-cli-"))
  const root = join(dirname(input.script), "../../..")
  const target = ManagedCli.requireTarget(input.target)

  const build = async () => {
    // SAFETY: the repository root package.json always pins packageManager.
    const packageManager = (
      JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { packageManager: string }
    ).packageManager

    await execFileAsync("bunx", [packageManager, "install", "--os=*", "--cpu=*", "--frozen-lockfile"], {
      cwd: root,
      env: process.env,
      windowsHide: true,
    })
    await execFileAsync(
      "bunx",
      [packageManager, input.script, "--skip-install", "--skip-web-ui", `--outdir=${directory}`],
      {
        cwd: root,
        env: { ...process.env, OPENCODE_VERSION: input.version, OPENCODE_TARGET: target },
        windowsHide: true,
      },
    )

    return stageLocalCli({ directory, target, version: input.version, output: input.output })
  }

  return build().finally(() => rm(directory, { recursive: true, force: true }))
}

/**
 * Verifies a Linux dist directory written by `packages/cli/script/build.ts` and copies
 * its `bin/panacode` to the private staging destination. The old `bin/opencode` layout
 * and a foreign manifest fail before anything is staged.
 */
export async function stageLocalCli(input: {
  directory: string
  target: string
  version: string
  output: string
}): Promise<LocalWslCli> {
  const target = ManagedCli.requireTarget(input.target)
  const directory = join(input.directory, `cli-${target}`)
  const manifest = decodeManifest(await readFile(join(directory, "package.json"), "utf8"))

  if (Option.isNone(manifest)) throw new Error(`The WSL CLI build at ${directory} has no valid package.json`)

  if (manifest.value.name !== ManagedCli.packageName(target))
    throw new Error(`The WSL CLI build names ${manifest.value.name}, not ${ManagedCli.packageName(target)}`)

  if (manifest.value.version !== input.version)
    throw new Error(`The WSL CLI build is version ${manifest.value.version}, not ${input.version}`)

  if (!manifest.value.os.includes("linux") || !manifest.value.cpu.includes(target.includes("-arm64") ? "arm64" : "x64"))
    throw new Error(`The WSL CLI build at ${directory} is not for ${target}`)

  const binary = join(directory, "bin", "panacode")
  const header = await readHeader(binary)
  const machine = target.includes("-arm64") ? 0xb7 : 0x3e

  if (
    header.length < 20 ||
    header[0] !== 0x7f ||
    header[1] !== 0x45 ||
    header[2] !== 0x4c ||
    header[3] !== 0x46 ||
    header[4] !== 2 ||
    header[5] !== 1 ||
    header.readUInt16LE(0x12) !== machine
  )
    throw new Error(`The WSL CLI build at ${binary} is not a Linux ${target.includes("-arm64") ? "arm64" : "x64"} executable`)

  await mkdir(dirname(input.output), { recursive: true })
  await copyFile(binary, input.output)
  const bytes = await readFile(input.output)

  if (!bytes.length) throw new Error(`The staged WSL CLI at ${input.output} is empty`)

  return { binary: input.output, version: input.version, target, sha256: createHash("sha256").update(bytes).digest("hex") }
}

async function readHeader(file: string) {
  const handle = await open(file, "r")

  try {
    const buffer = Buffer.alloc(20)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)

    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}