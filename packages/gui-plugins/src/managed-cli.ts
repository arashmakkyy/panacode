export * as ManagedCli from "./managed-cli"

import { createHash } from "node:crypto"
import { Schema } from "effect"

// The release contract for a managed Panacode CLI. Remote installers receive a
// reference derived from registry metadata, never a mutable tag or an unpinned
// URL, and verify the bytes before anything is executed or replaced.

const TARGET = /^(linux|darwin)-(x64|arm64)(-baseline)?(-musl)?$/

const VERSION = /^[0-9][A-Za-z0-9.+-]*$/

export const Metadata = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  os: Schema.Array(Schema.String),
  cpu: Schema.Array(Schema.String),
  dist: Schema.Struct({
    tarball: Schema.String,
    integrity: Schema.String,
  }),
})

export type Metadata = typeof Metadata.Type

export type Artifact = {
  readonly package: string
  readonly version: string
  readonly target: string
  readonly url: string
  /** SHA-512 of the tarball as lowercase hex, from the registry `dist.integrity` field. */
  readonly sha512: string
}

export function validVersion(value: string) {
  return value === "local" || VERSION.test(value)
}

export function requireVersion(value: string) {
  if (!VERSION.test(value)) throw new Error(`Unsupported Panacode CLI version: ${value}`)

  return value
}

export function requireTarget(value: string) {
  if (!TARGET.test(value)) throw new Error(`Unsupported Panacode CLI target: ${value}`)

  return value
}

export function packageName(target: string) {
  return `@panacode/cli-${requireTarget(target)}`
}

function tarballName(target: string) {
  return `cli-${requireTarget(target)}`
}

export function metadataUrl(target: string, version: string) {
  return `https://registry.npmjs.org/${packageName(target)}/${requireVersion(version)}`
}

export function tarballUrl(target: string, version: string) {
  return `https://registry.npmjs.org/${packageName(target)}/-/${tarballName(target)}-${requireVersion(version)}.tgz`
}

export function unavailable(target: string, version: string) {
  return `Managed Panacode CLI unavailable for ${requireTarget(target)} version ${requireVersion(version)}. Publish that target or install a released Panacode build first.`
}

/** Validates registry metadata and returns the immutable reference the installers verify. */
export function artifact(target: string, version: string, metadata: Metadata): Artifact {
  requireVersion(version)

  const name = packageName(target)

  if (metadata.name !== name) throw new Error(`${name} metadata names ${metadata.name}`)

  if (metadata.version !== version) throw new Error(`${name} metadata is version ${metadata.version}, not ${version}`)

  const os = target.startsWith("linux-") ? "linux" : "darwin"
  const cpu = target.includes("-arm64") ? "arm64" : "x64"

  if (!metadata.os.includes(os)) throw new Error(`${name} metadata does not support ${os}`)

  if (!metadata.cpu.includes(cpu)) throw new Error(`${name} metadata does not support ${cpu}`)

  const url = tarballUrl(target, version)

  if (metadata.dist.tarball !== url) throw new Error(`${name} metadata points at ${metadata.dist.tarball}`)

  return {
    package: name,
    version,
    target: requireTarget(target),
    url,
    sha512: integritySha512(metadata.dist.integrity),
  }
}

export function integritySha512(integrity: string) {
  const prefix = "sha512-"

  if (!integrity.startsWith(prefix)) throw new Error("The Panacode CLI artifact has no sha512 integrity")

  const encoded = integrity.slice(prefix.length)
  const bytes = Buffer.from(encoded, "base64")

  if (bytes.length !== 64 || bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, ""))
    throw new Error("The Panacode CLI artifact integrity is malformed")

  return bytes.toString("hex")
}

export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

export function sha512Hex(bytes: Uint8Array) {
  return createHash("sha512").update(bytes).digest("hex")
}