import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { ManagedCli } from "./managed-cli"

const target = "linux-x64-baseline"

const version = "2.0.0-beta.1"

const tarball = `https://registry.npmjs.org/@panacode/cli-${target}/-/cli-${target}-${version}.tgz`

function metadata(overrides: Partial<ManagedCli.Metadata> = {}): ManagedCli.Metadata {
  return {
    name: `@panacode/cli-${target}`,
    version,
    os: ["linux"],
    cpu: ["x64"],
    dist: {
      tarball,
      integrity: `sha512-${createHash("sha512").update("archive").digest("base64")}`,
    },
    ...overrides,
  }
}

test("a registry artifact pins the package, target and sha512 digest", () => {
  const artifact = ManagedCli.artifact(target, version, metadata())

  expect(artifact).toEqual({
    package: `@panacode/cli-${target}`,
    version,
    target,
    url: tarball,
    sha512: createHash("sha512").update("archive").digest("hex"),
  })
  expect(ManagedCli.metadataUrl(target, version)).toBe(
    `https://registry.npmjs.org/@panacode/cli-${target}/${version}`,
  )
  expect(ManagedCli.unavailable(target, version)).toContain("Managed Panacode CLI unavailable")
})

test("metadata from another package, version, platform or tarball is rejected", () => {
  expect(() => ManagedCli.artifact(target, version, metadata({ name: "@opencode/cli-linux-x64-baseline" }))).toThrow()
  expect(() => ManagedCli.artifact(target, version, metadata({ version: "2.0.0" }))).toThrow()
  expect(() => ManagedCli.artifact(target, version, metadata({ os: ["darwin"] }))).toThrow()
  expect(() => ManagedCli.artifact(target, version, metadata({ cpu: ["arm64"] }))).toThrow()
  expect(() =>
    ManagedCli.artifact(target, version, metadata({ dist: { ...metadata().dist, tarball: "https://example.com/a.tgz" } })),
  ).toThrow()
})

test("a missing, malformed or non-sha512 integrity is rejected", () => {
  expect(() => ManagedCli.artifact(target, version, metadata({ dist: { ...metadata().dist, integrity: "" } }))).toThrow()
  expect(() =>
    ManagedCli.artifact(target, version, metadata({ dist: { ...metadata().dist, integrity: "sha256-abc" } })),
  ).toThrow()
  expect(() =>
    ManagedCli.artifact(target, version, metadata({ dist: { ...metadata().dist, integrity: "sha512-abc" } })),
  ).toThrow()
  expect(() =>
    ManagedCli.artifact(
      target,
      version,
      metadata({ dist: { ...metadata().dist, integrity: `sha512-${"A".repeat(88)}` } }),
    ),
  ).toThrow()
})

test("targets and versions are shell-safe and cover every published Linux layout", () => {
  for (const value of ["linux-x64-baseline", "linux-x64-baseline-musl", "linux-arm64", "darwin-x64", "darwin-arm64"]) {
    expect(ManagedCli.requireTarget(value)).toBe(value)
  }

  for (const value of ["linux-x64;whoami", "linux-x64-", "../linux-x64", "windows-x64"]) {
    expect(() => ManagedCli.requireTarget(value)).toThrow()
  }

  for (const value of ["2.0.0", "2.0.0-beta.1", "2.0.0-rc.1+build.2"]) {
    expect(ManagedCli.requireVersion(value)).toBe(value)
  }

  for (const value of ['2.0.0"; whoami', "v2.0.0", "2.0.0\n"]) {
    expect(() => ManagedCli.requireVersion(value)).toThrow()
  }
})