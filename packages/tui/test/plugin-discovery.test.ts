import { expect, test } from "bun:test"
import { mkdir, symlink } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "./fixture/fixture"
import { discoverPluginTargets, localPluginDirectories, mergePluginTargets } from "../src/plugin/discovery"

test("deduplicates equivalent local plugin targets while retaining the final source", () => {
  const directory = "/project"
  const discovered = { entry: "/project/.panacode/plugins/example", install: true, optional: true }
  const server = { entry: "./.panacode/plugins/example", install: false, optional: true }

  expect(mergePluginTargets([discovered, server], directory)).toEqual([server])
})

test("preserves the first target position when a later source overrides it", () => {
  const first = { entry: "example", install: true, optional: true }
  const other = { entry: "other", install: true, optional: true }
  const configured = { entry: { package: "example", options: { enabled: true } }, install: true, optional: false }

  expect(mergePluginTargets([first, other, configured], "/project")).toEqual([configured, other])
})

test("local TUI plugin discovery ignores OpenCode directories and junctions", async () => {
  await using tmp = await tmpdir()
  const project = path.join(tmp.path, "repo")
  const native = path.join(project, ".panacode", "plugins")
  const foreign = path.join(project, ".opencode", "plugins")
  const global = path.join(tmp.path, "global")
  await mkdir(path.join(project, ".git"), { recursive: true })
  await mkdir(path.join(native, "example"), { recursive: true })
  await mkdir(path.join(foreign, "other"), { recursive: true })
  await mkdir(global)
  await symlink(foreign, path.join(global, "plugins"), process.platform === "win32" ? "junction" : "dir")
  await symlink(path.join(foreign, "other"), path.join(native, "linked"), process.platform === "win32" ? "junction" : "dir")

  const directories = await localPluginDirectories(project, global)
  expect(directories).toEqual([native])
  expect(await discoverPluginTargets([...directories, foreign])).toEqual([path.join(native, "example")])
})
