import { privateDirectory } from "@opencode/util/private-directory"
import { createHash } from "node:crypto"
import { fileDigest, stageCli } from "./stage-cli"
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Effect, Layer } from "effect"

import { cleanStages } from "./cli-stages"

describe("cleanStages", () => {
  test.each([
    { name: "upgrade", staged: ["2.0.18", "2.0.19", "2.0.20"], current: "2.0.20" },
    { name: "downgrade", staged: ["2.0.18", "2.0.19", "2.0.20"], current: "2.0.18" },
    { name: "prerelease", staged: ["2.0.20", "2.1.0-beta.1", "local"], current: "2.1.0-beta.1" },
    { name: "adopted server", staged: ["2.0.18", "2.0.19", "2.0.20"], current: "2.0.20", keep: ["2.0.19"] },
  ])("keeps only the current and adopted staged CLIs after $name", async (input) => {
    const root = mkdtempSync(path.join(tmpdir(), "panacode-cli-stages-"))

    try {
      const stage = (v: string) => v + "-x64-" + createHash("sha256").update(v).digest("hex")
      input.staged.forEach((version) => {
        mkdirSync(path.join(root, stage(version)))
        writeFileSync(path.join(root, stage(version), "panacode-cli"), version)
      })
      writeFileSync(path.join(root, "unrelated"), "")

      await Effect.runPromise(
        cleanStages(path.join(root, stage(input.current), "panacode-cli"), {
          keep: input.keep?.map((v) => v + "-x64"),
        }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
      )

      expect(readdirSync(root).sort()).toEqual(
        [stage(input.current), ...(input.keep ?? []).map(stage), "unrelated"].sort(),
      )
      expect(readdirSync(path.join(root, stage(input.current)))).toEqual(["panacode-cli"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

test("stage reuse verifies bytes and same-version rebuilds coexist", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "panacode-stage-"))
  try {
    const source = path.join(root, "packaged")
    writeFileSync(source, "first")
    const first = await fileDigest(source)
    const stage = () => stageCli(source, root, "panacode-cli", "1.0", first)
    const [a, b] = await Promise.all([stage(), stage()])
    expect(a).toBe(b)
    writeFileSync(a, "wrong")
    await stage()
    expect(await fileDigest(a)).toBe(first)
    writeFileSync(source, "other")
    expect(await stageCli(source, root, "panacode-cli", "1.0", await fileDigest(source))).not.toBe(a)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("private stage directories require local absolute paths", () => {
  expect(() => privateDirectory("relative")).toThrow()
  if (process.platform !== "win32") return
  expect(() => privateDirectory(String.raw`\\server\share\panacode`)).toThrow("local Windows drive")
})
