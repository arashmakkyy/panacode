import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { resolve as resolveBun } from "../src/persistent-pty/binary.bun"
import { resolve as resolveNode } from "../src/persistent-pty/binary.node"

const saved = {
  binary: process.env.PANACODE_PTY_BIN,
  digest: process.env.PANACODE_PTY_BIN_SHA256,
  path: process.env.PATH,
}

const installedName = process.platform === "win32" ? "panacode-pty.exe" : "panacode-pty"
const executable = process.platform === "win32" ? "opencode-pty.exe" : "opencode-pty"

afterEach(() => {
  restore("PANACODE_PTY_BIN", saved.binary)
  restore("PANACODE_PTY_BIN_SHA256", saved.digest)
  restore("PATH", saved.path)
})

describe("Bun persistent PTY resolver", () => {
  test("runs the embedded asset only from its private cache and rejects a wrong digest", async () => {
    const { root, cache, bytes, sha256 } = await fixture()
    try {
      const source = path.join(root, "asset", executable)
      await fs.mkdir(path.dirname(source), { recursive: true })
      await fs.writeFile(source, bytes)

      const installed = await resolveBun(cache, { path: source, version: "1.2.3", sha256 })
      expect(installed).toBe(path.join(cache, "panacode-pty", `1.2.3-${sha256.slice(0, 16)}`, installedName))
      expect(await fs.readFile(installed)).toEqual(bytes)

      await expect(
        resolveBun(cache, { path: source, version: "9.9.9", sha256: "0".repeat(64) }),
      ).rejects.toThrow("Embedded opencode-pty checksum mismatch")
      await expect(fs.stat(path.join(cache, "panacode-pty", `9.9.9-${"0".repeat(16)}`, installedName))).rejects.toMatchObject({
        code: "ENOENT",
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test.skipIf(process.platform === "win32")("marks the installed asset executable", async () => {
    const { root, cache, bytes, sha256 } = await fixture()
    try {
      const source = path.join(root, executable)
      await fs.writeFile(source, bytes)
      const installed = await resolveBun(cache, { path: source, version: "1.0.0", sha256 })
      expect((await fs.stat(installed)).mode & 0o777).toBe(0o755)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("repairs a cached asset with the right name but wrong bytes", async () => {
    const { root, cache, bytes, sha256 } = await fixture()
    try {
      const source = path.join(root, executable)
      await fs.writeFile(source, bytes)
      const asset = { path: source, version: "1.0.0", sha256 }
      const installed = await resolveBun(cache, asset)
      await fs.chmod(installed, 0o644)
      await fs.writeFile(installed, "replaced")

      expect(await resolveBun(cache, asset)).toBe(installed)
      expect(await fs.readFile(installed)).toEqual(bytes)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("concurrent installs of one asset converge on a valid binary", async () => {
    const { root, cache, bytes, sha256 } = await fixture()
    try {
      const source = path.join(root, executable)
      await fs.writeFile(source, bytes)
      const asset = { path: source, version: "2.0.0", sha256 }
      const results = await Promise.all([resolveBun(cache, asset), resolveBun(cache, asset), resolveBun(cache, asset)])

      expect(new Set(results).size).toBe(1)
      expect(await fs.readFile(results[0])).toEqual(bytes)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("refuses redirected cache ancestors and hard-linked destinations", async () => {
    const { root, cache, bytes, sha256 } = await fixture()
    try {
      const source = path.join(root, "source")
      await fs.writeFile(source, bytes)
      const foreign = path.join(root, "foreign")
      await fs.mkdir(foreign)
      const link = path.join(root, "alias")
      await fs.symlink(foreign, link, process.platform === "win32" ? "junction" : "dir")
      const asset = { path: source, version: "1.0.0", sha256 }
      await expect(resolveBun(path.join(link, "bin"), asset)).rejects.toThrow("Unsafe")
      expect(await fs.readdir(foreign)).toEqual([])
      const installed = await resolveBun(cache, asset)
      await fs.unlink(installed)
      await fs.link(source, installed)
      await expect(resolveBun(cache, asset)).rejects.toThrow("Unsafe")
      expect(await fs.readFile(source)).toEqual(bytes)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("a packed build ignores PANACODE_PTY_BIN and does not execute a PATH lookalike", async () => {
    const { root, cache, bytes, sha256 } = await fixture()
    try {
      const source = path.join(root, executable)
      await fs.writeFile(source, bytes)
      const lookalike = path.join(root, "bin", executable)
      await fs.mkdir(path.dirname(lookalike))
      await fs.writeFile(lookalike, "not the asset")
      process.env.PANACODE_PTY_BIN = lookalike

      const installed = await resolveBun(cache, { path: source, version: "3.0.0", sha256 })
      expect(installed.startsWith(path.join(cache, "panacode-pty"))).toBeTrue()
      expect(installed).not.toBe(lookalike)
      expect(await fs.readFile(lookalike, "utf8")).toBe("not the asset")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("a development checkout accepts only an absolute dependency file", async () => {
    const { root, cache, bytes } = await fixture()
    try {
      const dependency = path.join(root, "node_modules", "@opencode", "pty-win32-x64", "bin", executable)
      await fs.mkdir(path.dirname(dependency), { recursive: true })
      await fs.writeFile(dependency, bytes)

      expect(await resolveBun(cache, dependency)).toBe(path.resolve(dependency))
      restore("PANACODE_PTY_BIN", undefined)
      await expect(resolveBun(cache, "opencode-pty")).rejects.toThrow("must be an absolute path")
      await expect(resolveBun(cache, path.join("relative", executable))).rejects.toThrow("must be an absolute path")
      await expect(resolveBun(cache, path.join(root, "missing", executable))).rejects.toThrow("does not exist")
      await expect(resolveBun(cache, root)).rejects.toThrow("Unsafe")

      process.env.PANACODE_PTY_BIN = dependency
      delete process.env.PANACODE_PTY_BIN_SHA256
      await expect(resolveBun(cache, undefined)).rejects.toThrow("digest is required")
      process.env.PANACODE_PTY_BIN_SHA256 = createHash("sha256").update(bytes).digest("hex")
      expect(await resolveBun(cache, undefined)).toBe(path.resolve(dependency))
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test.skipIf(process.platform === "win32")("rejects a symlinked override", async () => {
    const { root, cache, bytes } = await fixture()
    try {
      const target = path.join(root, "target")
      const link = path.join(root, executable)
      await fs.writeFile(target, bytes)
      await fs.symlink(target, link, "file")
      process.env.PANACODE_PTY_BIN = link

      await expect(resolveBun(cache, undefined)).rejects.toThrow("Unsafe PANACODE_PTY_BIN")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("a build without an asset fails clearly instead of using PATH", async () => {
    const { root, cache } = await fixture()
    try {
      await expect(resolveBun(cache, undefined)).rejects.toThrow("No persistent PTY binary is available")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

describe("Node persistent PTY resolver", () => {
  test("requires an absolute binary and verifies the embedded digest", async () => {
    const { root, bytes, sha256 } = await fixture()
    try {
      const file = path.join(root, executable)
      await fs.writeFile(file, bytes)

      await expect(resolveNode(undefined, undefined)).rejects.toThrow("No persistent PTY binary is available")
      await expect(resolveNode("opencode-pty", undefined)).rejects.toThrow("must be an absolute path")
      await expect(resolveNode(file, undefined)).rejects.toThrow("digest is required")
      expect(await resolveNode(file, sha256)).toBe(path.resolve(file))
      await expect(resolveNode(file, "0".repeat(64))).rejects.toThrow("checksum mismatch")
      await expect(resolveNode(path.join(root, "missing"), undefined)).rejects.toThrow("does not exist")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-pty-binary-"))
  const bytes = Buffer.from(`binary ${process.platform}-${process.arch}`)
  return {
    root,
    cache: path.join(root, "cache"),
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}