import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

test("uninstall --dry-run reports a service and cache without stopping or deleting anything", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-uninstall-dry-"))
  const state = path.join(root, "state", "panacode")
  const cache = path.join(root, "cache", "panacode")
  const heartbeat = path.join(root, "heartbeat")
  await fs.mkdir(state, { recursive: true })
  await fs.mkdir(cache, { recursive: true })
  await fs.writeFile(path.join(cache, "marker"), "cache")
  const shell = path.join(root, ".bashrc")
  const shellBefore = `# user\n\n# panacode\nexport PATH=${path.join(root, ".panacode", "bin")}:$PATH\n`
  await fs.writeFile(shell, shellBefore)
  const witness = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/witness.ts"), heartbeat], {
    stdio: ["ignore", "ignore", "ignore"],
  })
  const registration = path.join(state, "service-local.json")
  try {
    await waitForHeartbeat(heartbeat)
    const info = { url: "http://127.0.0.1:1/", pid: witness.pid, version: "test", password: "legacy-secret" }
    await fs.writeFile(registration, JSON.stringify(info))
    const before = await fs.readFile(registration, "utf8")

    const result = await cli(["uninstall", "--dry-run"], root)

    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(result.stdout).toContain("Dry run - no changes made")
    expect(result.stdout).toContain("Panacode ownership not proven")
    expect(result.stdout).not.toMatch(/Package: .*(?:uninstall|remove)/)
    expect(result.stdout).toContain(`Stop background service and persistent terminals: ${registration}`)
    expect(result.stdout).toContain(`Cache: ${cache}`)
    expect(await fs.readFile(registration, "utf8")).toBe(before)
    expect(await fs.readFile(path.join(cache, "marker"), "utf8")).toBe("cache")
    expect(await fs.readFile(shell, "utf8")).toBe(shellBefore)
    expect(() => process.kill(witness.pid, 0)).not.toThrow()
  } finally {
    witness.kill()
    await witness.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

test("uninstall refuses to stop a legacy record and leaves the cache and process intact", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-uninstall-legacy-"))
  const state = path.join(root, "state", "panacode")
  const cache = path.join(root, "cache", "panacode")
  const heartbeat = path.join(root, "heartbeat")
  await fs.mkdir(state, { recursive: true })
  await fs.mkdir(cache, { recursive: true })
  await fs.writeFile(path.join(cache, "marker"), "cache")
  const witness = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/witness.ts"), heartbeat], {
    stdio: ["ignore", "ignore", "ignore"],
  })
  const registration = path.join(state, "service-local.json")
  try {
    await waitForHeartbeat(heartbeat)
    const info = { url: "http://127.0.0.1:1/", pid: witness.pid, version: "test", password: "legacy-secret" }
    await fs.writeFile(registration, JSON.stringify(info))
    const before = await fs.readFile(registration, "utf8")

    const result = await cli(["uninstall", "--force"], root)

    expect(result.exitCode).not.toBe(0)
    expect(result.stdout + result.stderr).toContain("Refusing to stop an unidentified process")
    expect(await fs.readFile(registration, "utf8")).toBe(before)
    expect(await fs.readFile(path.join(cache, "marker"), "utf8")).toBe("cache")
    expect(() => process.kill(witness.pid, 0)).not.toThrow()
  } finally {
    witness.kill()
    await witness.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

test("uninstall without confirmation leaves the shell config untouched", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-uninstall-cancel-"))
  const shell = path.join(root, ".bashrc")
  const before = `# user\n\n# panacode\nexport PATH=${path.join(root, ".panacode", "bin")}:$PATH\n`
  await fs.writeFile(shell, before)
  try {
    const result = await cli(["uninstall"], root)

    expect(result.exitCode).not.toBe(0)
    expect(result.stdout + result.stderr).toContain("Use --force")
    expect(await fs.readFile(shell, "utf8")).toBe(before)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

test("uninstall leaves a cache alias and the cache it points at untouched", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-uninstall-alias-"))
  const target = path.join(root, "cache", "opencode")
  const link = path.join(root, "cache", "panacode")
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, "marker"), "opencode-cache")
  await fs.symlink(target, link, process.platform === "win32" ? "junction" : "dir")
  try {
    const result = await cli(["uninstall", "--force"], root)

    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(result.stdout).toContain("symlink or shared alias")
    expect(await fs.readFile(path.join(target, "marker"), "utf8")).toBe("opencode-cache")
    expect(await fs.readdir(target)).toEqual(["marker"])
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

test("uninstall removes a normal private cache", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-uninstall-cache-"))
  const cache = path.join(root, "cache", "panacode")
  await fs.mkdir(cache, { recursive: true })
  await fs.writeFile(path.join(cache, "marker"), "panacode-cache")
  try {
    const result = await cli(["uninstall", "--force"], root)

    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(await fs.exists(cache)).toBe(false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

async function waitForHeartbeat(file: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (
      (await Bun.file(file)
        .text()
        .catch(() => "")) !== ""
    )
      return
    await Bun.sleep(10)
  }
  throw new Error("witness did not start")
}

async function cli(args: string[], root: string) {
  const child = Bun.spawn([process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), ...args], {
    cwd: path.join(import.meta.dir, ".."),
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_STATE_HOME: path.join(root, "state"),
      PANACODE_CONFIG_DIR: path.join(root, "config", "panacode"),
      PANACODE_TEST_HOME: root,
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}
