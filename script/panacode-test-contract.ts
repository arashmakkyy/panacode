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
import { statSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const argv = process.argv.slice(2)
const separator = argv.indexOf("--")

if (separator === -1) {
  usage("missing -- before the test paths")
}

const options = argv.slice(0, separator)
const files = argv.slice(separator + 1)
const values = new Map<string, string>()

for (let index = 0; index < options.length; index++) {
  const option = options[index]!
  if (option === "--help") usage()
  if (
    option !== "--cwd" &&
    option !== "--min-pass" &&
    option !== "--max-skip" &&
    option !== "--test-timeout" &&
    option !== "--timeout-ms"
  )
    usage(`unknown option ${option}`)
  const value = options[index + 1]
  if (value === undefined) usage(`${option} needs a value`)
  values.set(option, value)
  index++
}

if (files.length === 0) usage("no test paths after --")

const minPass = integer("--min-pass")
if (minPass === undefined) usage("--min-pass is required")
const maxSkip = integer("--max-skip") ?? 0
const testTimeout = integer("--test-timeout")
const timeoutMs = integer("--timeout-ms") ?? 15 * 60_000
const cwd = path.resolve(root, values.get("--cwd") ?? ".")

for (const file of files) {
  const target = path.resolve(cwd, file)
  const stat = statSync(target, { throwIfNoEntry: false })
  if (stat === undefined) fail(`missing test path ${file} (${target})`)
  if (!stat.isFile()) fail(`test path is not a file ${file} (${target})`)
}

const child = Bun.spawn(
  [process.execPath, "test", ...(testTimeout === undefined ? [] : ["--timeout", String(testTimeout)]), ...files],
  {
    cwd,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    stdout: "pipe",
    stderr: "pipe",
  },
)

let timedOut = false
const timer = setTimeout(() => {
  timedOut = true
  child.kill("SIGKILL")
}, timeoutMs)

const [stdout, stderr, code] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
])
clearTimeout(timer)

process.stdout.write(stdout)
process.stderr.write(stderr)

if (timedOut) fail(`timed out after ${timeoutMs}ms`)
if (code !== 0) fail(`bun test exited ${code}`)

// Bun prints test progress on stdout and the final counts and "Ran N tests" line on stderr.
const report = `${stdout}\n${stderr}`
const summary = [...report.matchAll(/^\s*(\d+)\s+(pass|fail|skip)$/gm)]
const counts = { pass: 0, fail: 0, skip: 0 }
for (const match of summary) counts[match[2] as keyof typeof counts] += Number(match[1])
const ran = report.match(/^Ran (\d+) tests? across (\d+) files?\./m)
const errors = report.match(/^\s*(\d+) errors?$/m)

if (ran === null) fail("bun test printed no 'Ran N tests' summary")
if (errors !== null && Number(errors[1]) > 0) fail(`${errors[1]} unhandled test errors`)
if (counts.fail !== 0) fail(`${counts.fail} tests failed`)
if (counts.pass < minPass) fail(`${counts.pass} tests passed, expected at least ${minPass}`)
if (counts.skip > maxSkip) fail(`${counts.skip} tests skipped, allowed at most ${maxSkip}`)

console.log(
  `panacode-test-contract: pass=${counts.pass} fail=${counts.fail} skip=${counts.skip} min-pass=${minPass} max-skip=${maxSkip} files=${ran[2]}`,
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