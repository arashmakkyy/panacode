import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  CLI_BINARIES,
  copyBuiltCliToResources,
  getCurrentCli,
  INSTALL_MANIFEST,
  INSTALL_MANIFEST_HEADER,
  inspectBuiltCli,
  provenanceFile,
  verifyPackagedCli,
  versionFile,
  writeInstallManifest,
} from "./utils"

function pe(machine: number) {
  const bytes = Buffer.alloc(0x80)
  bytes.write("MZ", 0, "latin1")
  bytes.writeUInt32LE(0x40, 0x3c)
  bytes.write("PE\0\0", 0x40, "latin1")
  bytes.writeUInt16LE(machine, 0x44)

  return bytes
}

function elf(machine: number) {
  const bytes = Buffer.alloc(0x80)
  bytes.write("\x7fELF", 0, "latin1")
  bytes[4] = 2
  bytes[5] = 1
  bytes[6] = 1
  bytes.writeUInt16LE(machine, 18)
  bytes.writeUInt32LE(1, 20)

  return bytes
}

function macho(cpu: number) {
  const bytes = Buffer.alloc(0x80)
  bytes.write("\xcf\xfa\xed\xfe", 0, "latin1")
  bytes.writeUInt32LE(cpu, 4)

  return bytes
}

function nativeBytes(target: string) {
  const cli = getCurrentCli(target)

  if (cli.os === "win32") return pe(cli.cpu === "arm64" ? 0xaa64 : 0x8664)

  if (cli.os === "darwin") return macho(cli.cpu === "arm64" ? 0x0100000c : 0x01000007)

  return elf(cli.cpu === "arm64" ? 183 : 62)
}

async function writeDist(
  root: string,
  target: string,
  input: {
    readonly name?: string
    readonly version?: string
    readonly os?: string[]
    readonly cpu?: string[]
    readonly bytes?: Uint8Array
  } = {},
) {
  const cli = getCurrentCli(target)
  const directory = path.join(root, cli.directory)
  await mkdir(path.join(directory, "bin"), { recursive: true })
  await writeFile(
    path.join(directory, "bin", cli.os === "win32" ? "panacode.exe" : "panacode"),
    input.bytes ?? nativeBytes(target),
  )
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: input.name ?? cli.package,
      version: input.version ?? "9.9.9",
      os: input.os ?? [cli.os],
      cpu: input.cpu ?? [cli.cpu],
    }),
  )

  return directory
}

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "panacode-desktop-cli-"))
}

async function withTarget(target: string, run: () => Promise<void>) {
  const previous = process.env.OPENCODE_TARGET
  process.env.OPENCODE_TARGET = target

  try {
    await run()
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_TARGET
    else process.env.OPENCODE_TARGET = previous
  }
}

test("desktop targets map to the CLI dist packages this checkout builds", () => {
  expect(CLI_BINARIES.map((item) => [item.target, item.directory])).toEqual([
    ["darwin-arm64", "cli-darwin-arm64"],
    ["darwin-x64", "cli-darwin-x64-baseline"],
    ["windows-arm64", "cli-windows-arm64"],
    ["windows-x64", "cli-windows-x64-baseline"],
    ["linux-x64", "cli-linux-x64-baseline"],
    ["linux-arm64", "cli-linux-arm64"],
  ])
  expect(getCurrentCli("windows-x64")).toMatchObject({
    directory: "cli-windows-x64-baseline",
    package: "@panacode/cli-windows-x64-baseline",
    os: "win32",
    cpu: "x64",
  })
  expect(() => getCurrentCli("windows-x86")).toThrow("not available")
})

test("every target accepts its own package manifest and native binary", async () => {
  const root = await tempDir()

  try {
    for (const item of CLI_BINARIES) {
      await writeDist(root, item.target)
      const built = await inspectBuiltCli(root, item.target)
      expect(built.manifest.version).toBe("9.9.9")
      expect(built.cli.package).toBe(`@panacode/${item.directory}`)
      expect(built.sourceSha256).toMatch(/^[0-9a-f]{64}$/)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a missing build names the checkout command and never falls back upstream", async () => {
  const root = await tempDir()

  try {
    const error = await inspectBuiltCli(root, "windows-x64").catch((error: Error) => error)

    expect(String(error)).toContain("No Panacode CLI build for windows-x64")
    expect(String(error)).toContain("OPENCODE_TARGET=windows-x64-baseline bun run --cwd packages/cli build --single")
    expect(String(error)).not.toContain("@opencode/")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a foreign manifest, wrong target, or wrong architecture is rejected before staging", async () => {
  for (const input of [
    {
      name: "foreign package",
      manifest: { name: "@opencode/cli-windows-x64-baseline" },
      message: /not the Panacode CLI package/,
    },
    { name: "wrong os", manifest: { os: ["linux"] }, message: /targets linux\/x64, not win32\/x64/ },
    { name: "wrong cpu", manifest: { cpu: ["arm64"] }, message: /targets win32\/arm64, not win32\/x64/ },
    {
      name: "wrong binary architecture",
      manifest: { bytes: nativeBytes("windows-arm64") },
      message: /must contain only x64 code/,
    },
  ]) {
    const root = await tempDir()

    try {
      await writeDist(root, "windows-x64", input.manifest)
      const error = await inspectBuiltCli(root, "windows-x64").catch((error: Error) => error)
      expect(String(error), input.name).toMatch(input.message)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test("a missing executable is rejected", async () => {
  const root = await tempDir()

  try {
    const directory = await writeDist(root, "windows-x64")
    await rm(path.join(directory, "bin", "panacode.exe"))
    const error = await inspectBuiltCli(root, "windows-x64").catch((error: Error) => error)
    expect(String(error)).toContain("missing the panacode.exe executable")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a requested version must match the dist manifest before anything is staged", async () => {
  const root = await tempDir()

  try {
    await writeDist(root, "windows-x64", { version: "2.0.0" })
    const dest = path.join(root, "resources", "panacode-cli.exe")

    await withTarget("windows-x64", async () => {
      const error = await copyBuiltCliToResources(root, dest, { version: "3.0.0" }).catch((error: Error) => error)

      expect(String(error)).toContain("is version 2.0.0, not the requested 3.0.0")
      expect(String(error)).toContain("OPENCODE_VERSION=3.0.0")
      expect(await Bun.file(dest).exists()).toBe(false)
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("staging records the source and exact staged bytes for the packaged app", async () => {
  const target =
    process.platform === "darwin" ? (process.arch === "arm64" ? "darwin-arm64" : "darwin-x64") : "windows-x64"

  const cli = getCurrentCli(target)
  const name = cli.os === "win32" ? "panacode-cli.exe" : "panacode-cli"
  const root = await tempDir()

  try {
    const directory = await writeDist(root, target, {
      bytes: process.platform === "darwin" ? await readFile(process.execPath) : undefined,
    })

    const dest = path.join(root, "resources", name)

    await withTarget(target, async () => {
      const staged = await copyBuiltCliToResources(root, dest)
      const source = await readFile(path.join(directory, "bin", cli.os === "win32" ? "panacode.exe" : "panacode"))

      expect(staged).toMatchObject({ version: "9.9.9", target, package: cli.package, binary: dest })
      expect(path.basename(dest)).toBe(cli.os === "win32" ? "panacode-cli.exe" : "panacode-cli")
      expect(versionFile(dest)).toBe(path.join(path.dirname(dest), "panacode-cli.version"))
      expect(provenanceFile(dest)).toBe(path.join(path.dirname(dest), `${path.basename(dest)}.provenance.json`))
      expect(staged.sourceSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(staged.sha256).toMatch(/^[0-9a-f]{64}$/)

      if (process.platform !== "darwin") expect(staged.sha256).toBe(staged.sourceSha256)
      expect(await readFile(dest)).toEqual(source)
      expect(await readFile(versionFile(dest), "utf8")).toBe("9.9.9")

      const provenance = JSON.parse(await readFile(provenanceFile(dest), "utf8"))
      expect(provenance).toEqual({
        version: "9.9.9",
        target,
        package: cli.package,
        sourceSha256: staged.sourceSha256,
        sha256: staged.sha256,
      })

      const unpacked = path.join(root, "unpacked", "resources", name)
      await mkdir(path.dirname(unpacked), { recursive: true })
      await writeFile(unpacked, await readFile(dest))
      await writeFile(versionFile(unpacked), await readFile(versionFile(dest)))

      const verified = await verifyPackagedCli({
        binary: unpacked,
        versionFile: versionFile(unpacked),
        provenanceFile: provenanceFile(dest),
        target: cli,
      })

      expect({ version: verified.version, sha256: verified.sha256 }).toEqual({
        version: "9.9.9",
        sha256: staged.sha256,
      })

      await writeFile(unpacked, Buffer.concat([await readFile(unpacked), Buffer.from([0])]))

      const error = await verifyPackagedCli({
        binary: unpacked,
        versionFile: versionFile(unpacked),
        provenanceFile: provenanceFile(dest),
        target: cli,
      }).catch((error: Error) => error)

      expect(String(error)).toContain("is not the binary recorded at build time")

      const wrongTarget = await verifyPackagedCli({
        binary: unpacked,
        versionFile: versionFile(unpacked),
        provenanceFile: provenanceFile(dest),
        target: getCurrentCli("linux-arm64"),
      }).catch((error: Error) => error)

      expect(String(wrongTarget)).toContain("provenance is for")
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a partial previous staging is overwritten before it can be verified", async () => {
  const root = await tempDir()

  try {
    const directory = await writeDist(root, "windows-x64")
    const dest = path.join(root, "resources", "panacode-cli.exe")
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, "incomplete")
    await writeFile(versionFile(dest), "1.0.0")
    await writeFile(provenanceFile(dest), "{")

    await withTarget("windows-x64", async () => {
      const staged = await copyBuiltCliToResources(root, dest)

      const verified = await verifyPackagedCli({
        binary: dest,
        versionFile: versionFile(dest),
        provenanceFile: provenanceFile(dest),
        target: getCurrentCli("windows-x64"),
      })

      expect(verified.version).toBe("9.9.9")
      expect(await readFile(dest)).toEqual(await readFile(path.join(directory, "bin", "panacode.exe")))
      expect(staged.version).toBe("9.9.9")
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("the Windows install manifest records only owned files with exact sizes", async () => {
  const root = await tempDir()
  const app = path.join(root, "app")
  const outside = path.join(root, "outside")

  try {
    await mkdir(path.join(app, "resources", "nested"), { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(path.join(app, "Panacode.exe"), "exe")
    await writeFile(path.join(app, "resources", "nested", "app.asar"), "asar")
    await writeFile(path.join(app, "resources", "empty.bin"), "")
    await writeFile(path.join(app, INSTALL_MANIFEST), "stale manifest")
    await writeFile(path.join(outside, "foreign.txt"), "foreign")
    await symlink(outside, path.join(app, "linked"), process.platform === "win32" ? "junction" : "dir")

    await writeInstallManifest({
      appDir: app,
      appId: "ai.panacode.desktop",
      version: "2.3.0",
      executable: "Panacode.exe",
    })

    expect(await readFile(path.join(app, INSTALL_MANIFEST), "utf8")).toBe(
      [
        INSTALL_MANIFEST_HEADER,
        "app=ai.panacode.desktop",
        "version=2.3.0",
        "exe=Panacode.exe",
        "3\nPanacode.exe",
        "0\nresources\\empty.bin",
        "4\nresources\\nested\\app.asar",
      ].join("\n") + "\n",
    )

    await writeInstallManifest({
      appDir: app,
      appId: "ai.panacode.desktop",
      version: "2.3.0",
      executable: "Panacode.exe",
    })
    expect(await readFile(path.join(app, INSTALL_MANIFEST), "utf8")).not.toContain("stale manifest")
    expect(await readFile(path.join(app, INSTALL_MANIFEST), "utf8")).not.toContain("foreign.txt")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("the install manifest writer runs in electron-builder's Node runtime", async () => {
  const root = await tempDir()
  const app = path.join(root, "app")

  try {
    await mkdir(app, { recursive: true })
    await writeFile(path.join(app, "Panacode.exe"), "exe")

    const input = JSON.stringify({
      appDir: app,
      appId: "ai.panacode.desktop",
      version: "2.3.0",
      executable: "Panacode.exe",
    })
    const script = [
      'const path = require("node:path")',
      'const { createRequire } = require("node:module")',
      'const root = process.cwd()',
      'const requireFromDesktop = createRequire(path.join(root, "packages/desktop/package.json"))',
      'const electronBuilder = requireFromDesktop.resolve("electron-builder/package.json")',
      'const appBuilder = require.resolve("app-builder-lib/package.json", { paths: [path.dirname(electronBuilder)] })',
      'const jiti = require.resolve("jiti", { paths: [path.dirname(appBuilder)] })',
      'const runner = require(jiti).createJiti(path.join(root, "packages/desktop/electron-builder.config.ts"))',
      `runner.import(path.join(root, "packages/desktop/script/utils.ts")).then((utils) => utils.writeInstallManifest(${input})).catch((error) => { console.error(error); process.exit(1) })`,
    ].join("\n")

    const result = Bun.spawnSync(["node", "-e", script], {
      cwd: path.resolve(import.meta.dir, "../../.."),
      stdout: "pipe",
      stderr: "pipe",
    })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())

    expect(await readFile(path.join(app, INSTALL_MANIFEST), "utf8")).toContain("3\nPanacode.exe")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a path the installer cannot read as ANSI fails the manifest instead of being omitted", async () => {
  const root = await tempDir()

  try {
    await writeFile(path.join(root, "café.txt"), "not ascii")

    const error = await writeInstallManifest({
      appDir: root,
      appId: "ai.panacode.desktop",
      version: "2.3.0",
      executable: "Panacode.exe",
    }).catch((error: Error) => error)

    expect(String(error)).toContain("cannot record the non-ASCII path café.txt")
    expect(await Bun.file(path.join(root, INSTALL_MANIFEST)).exists()).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
