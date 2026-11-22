import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

test("a skipped required case, missing case file or printed passing summary fails CI", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "panacode-contract-"))
  const wrapper = path.join(import.meta.dirname, "panacode-test-contract.ts")
  const run = (...files: string[]) =>
    Bun.spawnSync({
      cmd: [
        process.execPath,
        wrapper,
        "--cwd",
        cwd,
        "--min-pass",
        "1",
        "--max-skip",
        "1",
        "--require-pass",
        "critical",
        "--",
        ...files,
      ],
    }).exitCode
  try {
    await writeFile(
      path.join(cwd, "basic.test.ts"),
      'import {test,expect} from "bun:test"; test("critical", () => expect(true).toBe(true))',
    )
    expect(run("./basic.test.ts")).toBe(0)
    await writeFile(path.join(cwd, "empty.test.ts"), 'console.log("20 pass")')
    expect(run("./basic.test.ts", "./empty.test.ts")).not.toBe(0)
    await writeFile(
      path.join(cwd, "basic.test.ts"),
      'import {test,expect} from "bun:test"; test.skip("critical", () => {}); test("other", () => expect(true).toBe(true))',
    )
    expect(run("./basic.test.ts")).not.toBe(0)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
