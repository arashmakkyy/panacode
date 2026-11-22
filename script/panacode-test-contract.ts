#!/usr/bin/env bun
/**
 * Runs one Bun test command and treats "nothing actually ran" as a failure.
 *
 * `bun test` exits 0 when every test in an existing file is skipped, so a Windows acceptance suite
 * can silently regress to a skip and the workflow still looks green. This wrapper is the CI
 * contract for one test group:
 *
 *   - every listed path must exist and be a file;
 *   - at least `--min-pass` tests must pass;
 *   - at most `--max-skip` tests may be skipped (default 0);
 *   - a failing test, a missing summary, or the wrapper timeout fails the step.
 *
 *   bun script/panacode-test-contract.ts --cwd packages/cli --min-pass 7 -- ./test/service-lifecycle.test.ts
 *
 * `--test-timeout` forwards Bun's per-test timeout for process-heavy suites; `--timeout-ms`
 * bounds the whole command. The Bun output is printed unchanged, followed by one
 * machine-readable result line.
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"

const root = path.resolve(import.meta.dir, "..")
const argv = process.argv.slice(2)
const separator = argv.indexOf("--")

if (separator === -1) {
  usage("missing -- before the test paths")
}

const options = argv.slice(0, separator)
const files = argv.slice(separator + 1)
const values = new Map<string, string>()
const requiredCases: string[] = []

for (let index = 0; index < options.length; index++) {
  const option = options[index]!
  if (option === "--help") usage()
  if (
    option !== "--require-pass" &&
    option !== "--cwd" &&
    option !== "--min-pass" &&
    option !== "--max-skip" &&
    option !== "--test-timeout" &&
    option !== "--timeout-ms"
  )
    usage(`unknown option ${option}`)
  const value = options[index + 1]
  if (value === undefined) usage(`${option} needs a value`)
  if (option === "--require-pass") requiredCases.push(value)
  else values.set(option, value)
  index++
}

if (files.length === 0) usage("no test paths after --")

const minPass = integer("--min-pass")
if (!minPass) usage("--min-pass must be positive")
const maxSkip = integer("--max-skip") ?? 0
const testTimeout = integer("--test-timeout")
const timeoutMs = integer("--timeout-ms") ?? 15 * 60_000
const cwd = path.resolve(root, values.get("--cwd") ?? ".")

const requested = new Set(files.map((file) => path.resolve(cwd, file)))
if (requested.size !== files.length) usage("duplicate test path")
for (const file of files) {
  const target = path.resolve(cwd, file)
  const stat = statSync(target, { throwIfNoEntry: false })
  if (stat === undefined) fail(`missing test path ${file} (${target})`)
  if (!stat.isFile()) fail(`test path is not a file ${file} (${target})`)
}

const temporary = mkdtempSync(path.join(tmpdir(), "panacode-test-report-"))
process.on("exit", () => rmSync(temporary, { recursive: true, force: true }))
const junit = path.join(temporary, "result.xml")
const child = Bun.spawn(
  [
    process.execPath,
    "test",
    "--reporter=junit",
    "--reporter-outfile",
    junit,
    ...(testTimeout === undefined ? [] : ["--timeout", String(testTimeout)]),
    ...files,
  ],
  {
    cwd,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    stdout: "pipe",
    stderr: "pipe",
  },
)

const timer = setTimeout(() => {
  child.kill("SIGKILL")
  // A surviving descendant can keep a pipe open after the test runner dies.
  fail(`timed out after ${timeoutMs}ms`)
}, timeoutMs)

const [stdout, stderr, code] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
])
clearTimeout(timer)

process.stdout.write(stdout)
process.stderr.write(stderr)

if (code !== 0) fail(`bun test exited ${code}`)

// Only the runner writes this file. Console output from a test or a subprocess
// cannot supply counts or stand in for a missing test file.
const xml = readFileSync(junit, "utf8")
const summary = xml.match(/^<testsuites [^>]+>/m)?.[0]
if (!summary || !xml.trimEnd().endsWith("</testsuites>")) fail("incomplete Bun JUnit report")
function count(attribute: string) {
  const match = summary!.match(new RegExp(` ${attribute}="([0-9]+)"`))
  if (!match) fail(`missing JUnit ${attribute}`)
  return Number(match[1])
}
const total = count("tests")
const failed = count("failures")
const skipped = count("skipped")
const passed = total - failed - skipped
const cases = [...xml.matchAll(/^\s*<testcase\s+[^>]*?\bfile="([^"]+)"[^>]*>/gm)]
for (const name of requiredCases) {
  const named = cases.filter((item) => item[0].includes(` name="${name}"`))
  // Bun uses an empty element for a successful test. Skips have a <skipped/> child.
  if (named.length !== 1 || !named[0]![0].endsWith("/>") || !/ assertions="[1-9][0-9]*"/.test(named[0]![0]))
    fail(`required test did not pass with assertions: ${name}`)
}
if (total !== cases.length) fail(`JUnit total ${total} differs from ${cases.length} test cases`)
const tested = new Set(cases.map((value) => path.resolve(cwd, value[1]!.replaceAll("&amp;", "&"))))
if (tested.size !== requested.size || [...requested].some((file) => !tested.has(file)))
  fail("executed test files differ from requested test files")
if (/ errors="[1-9][0-9]*"/.test(summary) || failed || /<error(?:\s|>)/.test(xml))
  fail("JUnit contains a failure or unhandled error")
if (passed < minPass) fail(`${passed} tests passed, expected at least ${minPass}`)
if (skipped > maxSkip) fail(`${skipped} tests skipped, allowed at most ${maxSkip}`)
console.log(
  `panacode-test-contract: pass=${passed} fail=${failed} skip=${skipped} min-pass=${minPass} max-skip=${maxSkip} files=${tested.size}`,
)

function integer(name: string) {
  const raw = values.get(name)
  if (raw === undefined) return undefined
  if (!/^\d+$/.test(raw)) usage(`${name} must be a non-negative integer`)
  return Number(raw)
}

function fail(message: string): never {
  console.error(`panacode-test-contract: ${message}`)
  process.exit(1)
}

function usage(message?: string): never {
  if (message !== undefined) console.error(`panacode-test-contract: ${message}`)
  console.error(
    "usage: bun script/panacode-test-contract.ts --cwd <dir> --min-pass <n> [--max-skip <n>] [--test-timeout <ms>] [--timeout-ms <ms>] -- <test paths...>",
  )
  process.exit(message === undefined ? 0 : 1)
}
