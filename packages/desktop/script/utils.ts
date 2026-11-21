import { chmod, copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises"
import { createHash } from "node:crypto"
import { basename, dirname, join, relative } from "node:path"
import { Option, Schema } from "effect"
import { ProductIdentity } from "@opencode/util/product-identity"
import { NativeArch } from "../../../script/native-arch"

export type Channel = "dev" | "beta" | "prod"

export type CliBinary = {
  readonly target: string
  readonly directory: string
  readonly os: "darwin" | "win32" | "linux"
  readonly cpu: "x64" | "arm64"
}

// Each desktop target stages the CLI build the release workflow produces for it. Windows x64 packs the
// baseline build on purpose: the desktop still reports the non-baseline target, but the sidecar runs on
// older CPUs. The directory names match the package directories written by packages/cli/script/build.ts.
export const CLI_BINARIES: readonly CliBinary[] = [
  { target: "darwin-arm64", directory: "cli-darwin-arm64", os: "darwin", cpu: "arm64" },
  { target: "darwin-x64", directory: "cli-darwin-x64-baseline", os: "darwin", cpu: "x64" },
  { target: "windows-arm64", directory: "cli-windows-arm64", os: "win32", cpu: "arm64" },
  { target: "windows-x64", directory: "cli-windows-x64-baseline", os: "win32", cpu: "x64" },
  { target: "linux-x64", directory: "cli-linux-x64-baseline", os: "linux", cpu: "x64" },
  { target: "linux-arm64", directory: "cli-linux-arm64", os: "linux", cpu: "arm64" },
]

const Manifest = Schema.Struct({
  name: Schema.NonEmptyString,
  version: Schema.NonEmptyString,
  os: Schema.Array(Schema.String),
  cpu: Schema.Array(Schema.String),
})

const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(Manifest))

const Provenance = Schema.Struct({
  version: Schema.NonEmptyString,
  target: Schema.NonEmptyString,
  package: Schema.NonEmptyString,
  sourceSha256: Schema.String,
  sha256: Schema.String,
})

export type Provenance = typeof Provenance.Type

const decodeProvenance = Schema.decodeUnknownOption(Schema.fromJsonString(Provenance))

export function resolveChannel(): Channel {
  const raw = process.env.OPENCODE_CHANNEL

  if (raw === "dev" || raw === "beta" || raw === "prod") return raw

  if (raw === "latest") return "prod"

  return "dev"
}

function nativeTarget() {
  const { platform, arch } = process

  if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : "darwin-x64"

  if (platform === "win32") return arch === "arm64" ? "windows-arm64" : "windows-x64"

  if (platform === "linux") return arch === "arm64" ? "linux-arm64" : "linux-x64"
  throw new Error(`Unsupported platform: ${platform}/${arch}`)
}

export function getCurrentCli(target = process.env.OPENCODE_TARGET ?? nativeTarget()) {
  const binaryConfig = CLI_BINARIES.find((item) => item.target === target)

  if (!binaryConfig) throw new Error(`CLI configuration not available for target '${target}'`)

  return { ...binaryConfig, package: `@panacode/${binaryConfig.directory}` }
}

export function nodePtyPackage(target?: string) {
  const cli = getCurrentCli(target)

  return `@lydell/node-pty-${cli.os}-${cli.cpu}`
}

/** The local build that satisfies this desktop target, used in errors instead of an upstream download. */
export function buildCommand(target?: string) {
  const cli = getCurrentCli(target)

  return `OPENCODE_TARGET=${cli.directory.slice("cli-".length)} bun run --cwd packages/cli build --single`
}

/**
 * Validates the CLI produced from this checkout: its dist package must name the fork's package, carry the
 * expected target and CPU, and contain a native binary for that CPU. Nothing is copied before this passes.
 */
export async function inspectBuiltCli(root: string, target?: string) {
  const cli = getCurrentCli(target)
  const directory = join(root, cli.directory)
  const manifestText = await readFile(join(directory, "package.json"), "utf8").catch(() => undefined)
  const manifest = manifestText === undefined ? undefined : Option.getOrUndefined(decodeManifest(manifestText))

  if (!manifest)
    throw new Error(
      `No Panacode CLI build for ${cli.target} at ${directory}. Build it from this checkout first: ${buildCommand(cli.target)}`,
    )

  if (manifest.name !== cli.package)
    throw new Error(
      `The CLI build at ${directory} is package ${manifest.name}, not the Panacode CLI package ${cli.package}. Rebuild it from this checkout: ${buildCommand(cli.target)}`,
    )

  if (!manifest.os.includes(cli.os) || !manifest.cpu.includes(cli.cpu))
    throw new Error(
      `The CLI build at ${directory} targets ${manifest.os.join(",")}/${manifest.cpu.join(",")}, not ${cli.os}/${cli.cpu}. Rebuild it from this checkout: ${buildCommand(cli.target)}`,
    )

  const binary = join(directory, "bin", cli.os === "win32" ? `${ProductIdentity.cli}.exe` : ProductIdentity.cli)
  const info = await stat(binary).catch(() => undefined)

  if (!info?.isFile() || info.size === 0)
    throw new Error(
      `The Panacode CLI build at ${directory} is missing the ${basename(binary)} executable. Rebuild it from this checkout: ${buildCommand(cli.target)}`,
    )

  const sourceSha256 = await sha256File(binary)

  await NativeArch.verify(binary, cli.cpu)

  return { cli, directory, manifest, binary, sourceSha256 }
}

/**
 * Stages a CLI built from this checkout next to the desktop. A requested version must match the dist
 * manifest, so a stale build cannot be labelled as another release. The provenance file records the
 * source digest and the digest that electron-builder must copy unchanged.
 */
export async function copyBuiltCliToResources(
  root: string,
  dest?: string,
  options: { readonly version?: string } = {},
) {
  const built = await inspectBuiltCli(root)

  if (options.version !== undefined && built.manifest.version !== options.version)
    throw new Error(
      `The Panacode CLI build at ${built.directory} is version ${built.manifest.version}, not the requested ${options.version}. Rebuild it from this checkout: OPENCODE_VERSION=${options.version} ${buildCommand(built.cli.target)}`,
    )

  const binary = dest ?? resourceCliPath(built.cli.os)

  await mkdir(dirname(binary), { recursive: true })
  await copyFile(built.binary, binary)
  await prepareCli(binary)

  const sha256 = await sha256File(binary)

  if (process.platform !== "darwin" && sha256 !== built.sourceSha256)
    throw new Error(`The Panacode CLI changed while it was staged: ${binary}`)

  const provenance = {
    version: built.manifest.version,
    target: built.cli.target,
    package: built.cli.package,
    sourceSha256: built.sourceSha256,
    sha256,
  } satisfies Provenance

  await Bun.write(versionFile(binary), built.manifest.version)
  await Bun.write(provenanceFile(binary), JSON.stringify(provenance, null, 2))
  console.log(`Bundled Panacode CLI ${provenance.version} for ${provenance.target} from ${built.directory}`)

  return { ...provenance, binary }
}

/**
 * Verifies the CLI electron-builder put in the app resources against the provenance from staging. A
 * matching version string is not enough: the bytes must be the exact binary recorded at build time.
 */
export async function verifyPackagedCli(input: {
  readonly binary: string
  readonly versionFile: string
  readonly provenanceFile: string
  readonly target?: ReturnType<typeof getCurrentCli>
}) {
  const cli = input.target ?? getCurrentCli()
  const text = await readFile(input.provenanceFile, "utf8").catch(() => undefined)
  const provenance = text === undefined ? undefined : Option.getOrUndefined(decodeProvenance(text))

  if (!provenance) throw new Error(`The bundled Panacode CLI has no build provenance: ${input.provenanceFile}`)

  if (provenance.target !== cli.target || provenance.package !== cli.package)
    throw new Error(
      `The bundled Panacode CLI provenance is for ${provenance.package} (${provenance.target}), not ${cli.package} (${cli.target})`,
    )

  const version = (await readFile(input.versionFile, "utf8").catch(() => "")).trim()

  if (!version || version !== provenance.version)
    throw new Error(
      `The bundled Panacode CLI version file ${input.versionFile} does not match the built version ${provenance.version}`,
    )

  const sha256 = await sha256File(input.binary)

  if (sha256 !== provenance.sha256)
    throw new Error(
      `The bundled Panacode CLI ${input.binary} is not the binary recorded at build time (${sha256} != ${provenance.sha256})`,
    )

  return { ...provenance, sha256 }
}

export function versionFile(cli: string) {
  return join(dirname(cli), `${ProductIdentity.cli}-cli.version`)
}

export function provenanceFile(cli: string) {
  return join(dirname(cli), `${basename(cli)}.provenance.json`)
}

function resourceCliPath(os: string) {
  return os === "win32" ? `resources/${ProductIdentity.cli}-cli.exe` : `resources/${ProductIdentity.cli}-cli`
}

async function prepareCli(dest: string) {
  const { $ } = await import("bun")

  if (process.platform !== "win32") await chmod(dest, 0o755)

  if (process.platform === "darwin") await $`codesign --force --sign - ${dest}`
}

async function sha256File(file: string) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex")
}

/**
 * Records the exact files the packaged app owns, so the Windows installer can prove that a directory
 * belongs to this app before it deletes anything. An executable or marker alone is not proof.
 *
 * The NSIS installer reads this as ANSI text, so every path must be plain ASCII. A path it cannot
 * represent is a build error instead of a manifest that silently omits files.
 */
export async function writeInstallManifest(input: {
  readonly appDir: string
  readonly appId: string
  readonly version: string
  readonly executable: string
}) {
  for (const value of [input.appId, input.version, input.executable])
    if (!/^[\x20-\x7e]+$/.test(value))
      throw new Error(`The Windows install manifest cannot record the non-ASCII value ${JSON.stringify(value)}`)

  const files = await collectInstallFiles(input.appDir)

  const entries = await Promise.all(
    files.map(async (file) => {
      const name = relative(input.appDir, file)

      if (name === INSTALL_MANIFEST) return undefined

      if (!/^[\x20-\x7e]+$/.test(name))
        throw new Error(`The Windows install manifest cannot record the non-ASCII path ${name}`)

      return { name, size: (await stat(file)).size }
    }),
  )

  const manifest = [
    INSTALL_MANIFEST_HEADER,
    `app=${input.appId}`,
    `version=${input.version}`,
    `exe=${input.executable}`,
    ...entries
      .filter((entry): entry is { readonly name: string; readonly size: number } => entry !== undefined)
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
      .map((entry) => `${entry.size}\n${entry.name}`),
  ].join("\n")

  await Bun.write(join(input.appDir, INSTALL_MANIFEST), `${manifest}\n`)
}

export const INSTALL_MANIFEST = ".panacode-install"

export const INSTALL_MANIFEST_HEADER = "panacode-install 1"

// Reparse points are not owned by the package, and following one would record files outside appDir.
async function collectInstallFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })

  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isSymbolicLink()) return []

      const file = join(dir, entry.name)

      if (entry.isDirectory()) return collectInstallFiles(file)

      return entry.isFile() ? [file] : []
    }),
  )

  return nested.flat()
}

export function windowsify(path: string) {
  if (path.endsWith(".exe")) return path

  return `${path}${process.platform === "win32" ? ".exe" : ""}`
}
