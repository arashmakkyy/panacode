import { expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { resolveStateRoot } from "./state-root"

const home = path.join(os.tmpdir(), "panacode-state-root", "home")
const defaultRoot = path.join(home, ".local", "state")
const inherited = path.join(os.tmpdir(), "panacode-state-root", "inherited")
const shell = path.join(os.tmpdir(), "panacode-state-root", "shell")
const isolated = path.join(os.tmpdir(), "panacode-state-root", "isolated")
const spaced = path.join(os.tmpdir(), "panacode-state-root", "state dir-é")

test.each([
  { name: "default home", input: {}, expected: defaultRoot },
  { name: "absolute inherited root", input: { inherited }, expected: inherited },
  {
    name: "inherited root outranks the shell",
    input: { inherited, shell },
    expected: inherited,
  },
  { name: "shell root when nothing is inherited", input: { shell }, expected: shell },
  { name: "relative inherited root", input: { inherited: "relative/state" }, expected: defaultRoot },
  { name: "relative shell root", input: { shell: "relative/state" }, expected: defaultRoot },
  {
    name: "absolute shell root after a relative inherited root",
    input: { inherited: "relative/state", shell },
    expected: shell,
  },
  { name: "isolated root outranks inherited", input: { inherited, isolatedRoot: isolated }, expected: isolated },
  {
    name: "relative isolated root falls through to inherited",
    input: { inherited, isolatedRoot: "relative/state" },
    expected: inherited,
  },
  { name: "spaces and non-ASCII", input: { inherited: spaced }, expected: spaced },
  {
    name: "isolated root with spaces and non-ASCII",
    input: { isolatedRoot: path.join(spaced, "dev") },
    expected: path.join(spaced, "dev"),
  },
] as const)("resolveStateRoot: $name", ({ input, expected }) => {
  expect(resolveStateRoot({ home, ...input })).toBe(expected)
})

test.skipIf(process.platform !== "win32")("resolveStateRoot: UNC inherited root", () => {
  const unc = "\\\\server\\share\\panacode-state"

  expect(resolveStateRoot({ home, inherited: unc })).toBe(unc)
})

test.skipIf(process.platform !== "win32")("resolveStateRoot: drive-relative root is not absolute", () => {
  expect(resolveStateRoot({ home, inherited: "C:state" })).toBe(defaultRoot)
})