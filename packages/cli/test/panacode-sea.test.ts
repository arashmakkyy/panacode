import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { nodePrelude } from "../vite.node.config"
import { nodeTarget } from "../src/node/target"
import { resolveOpencodePty } from "../script/opencode-pty"

test("a real Node SEA extracts and runs its pinned PTY without changing OpenCode's cache", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-sea-test-"))
  const node = process.env.PANACODE_SEA_TEST_NODE ?? "node"
  const target = nodeTarget(process.platform, process.arch)
  const oldOverride = process.env.PANACODE_PTY_BIN
  try {
    expect(spawnSync(node, ["--version"], { encoding: "utf8" }).stdout.trim()).toBe("v26.4.0")
    // Compile-time and runtime overrides are intentionally unrelated to the executable in the SEA.
    process.env.PANACODE_PTY_BIN = path.join(root, "unused-override")
    const pty = await resolveOpencodePty(target)
    if (!pty) throw new Error("No platform PTY dependency")
    expect(pty.source).not.toBe(process.env.PANACODE_PTY_BIN)
    const banner = nodePrelude({ version: "1.0.0", channel: "test", target, assetHash: "a1", ptySha256: pty.sha256 })
    const source = path.join(root, "entry.mjs")
    await fs.writeFile(
      source,
      banner +
        `
import { spawnSync as runPty } from "node:child_process"
const pinned = globalThis.__PANACODE_PACKAGED_PTY
if (!Object.isFrozen(pinned) || !__ocIsSea()) throw new Error("Missing SEA provenance")
const result = runPty(pinned.file, ["--version"], { encoding: "utf8" })
if (result.status !== 0) throw new Error("Packaged PTY did not start")
console.log(JSON.stringify({ ...pinned, version: result.stdout.trim() }))
`,
    )
    const binary = path.join(root, process.platform === "win32" ? "fixture.exe" : "fixture")
    const config = path.join(root, "sea.json")
    await fs.writeFile(
      config,
      JSON.stringify({
        main: source,
        mainFormat: "module",
        output: binary,
        disableExperimentalSEAWarning: true,
        assets: { [target.opencodePtyAsset]: pty.source },
      }),
    )
    const build = spawnSync(node, ["--build-sea", config], { encoding: "utf8", timeout: 60_000 })
    expect(build.status, build.stderr).toBe(0)
    const user = process.getuid?.() ?? "user"
    const foreign = path.join(root, `opencode-node-${user}`)
    await fs.mkdir(foreign, { mode: 0o755 })
    const original = await fs.stat(foreign)
    const run = () =>
      spawnSync(binary, [], {
        encoding: "utf8",
        timeout: 15_000,
        env: { ...process.env, TMPDIR: root, TEMP: root, TMP: root },
      })
    const cold = run()
    expect(cold.status, cold.stderr).toBe(0)
    const record = JSON.parse(cold.stdout)
    const cache = path.join(root, `panacode-node-${user}`, `a1-${target.platform}-${target.arch}`)
    expect(record.file).toBe(path.join(await fs.realpath(cache), target.opencodePtyAsset))
    expect(record.sha256).toBe(pty.sha256)
    expect(record.version).toContain(pty.version)
    await fs.writeFile(record.file, "incomplete")
    expect(run().status).toBe(0)
    expect(
      createHash("sha256")
        .update(await fs.readFile(record.file))
        .digest("hex"),
    ).toBe(pty.sha256)
    await fs.rm(cache, { recursive: true })
    await fs.symlink(foreign, cache, process.platform === "win32" ? "junction" : "dir")
    const linked = run()
    expect(linked.status).not.toBe(0)
    expect(linked.stderr).toContain("Unsafe Node asset cache directory")
    expect(await fs.readdir(foreign)).toEqual([])
    expect((await fs.stat(foreign)).mode).toBe(original.mode)
  } finally {
    if (oldOverride === undefined) delete process.env.PANACODE_PTY_BIN
    else process.env.PANACODE_PTY_BIN = oldOverride
    await fs.rm(root, { recursive: true, force: true })
  }
}, 120_000)
