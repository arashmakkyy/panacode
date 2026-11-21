import { expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { cliServiceRegistrationFile } from "./cli-service-file"

const home = path.join(os.tmpdir(), "panacode-registration", "home")
const stateHome = path.join(os.tmpdir(), "panacode-registration", "state dir-é")

test.each([
  {
    version: "2.3.0",
    expected: path.join("/home/ali", ".local", "state", "panacode", "service.json"),
  },
  {
    version: "0.0.0-latest-202611150802",
    expected: path.join("/home/ali", ".local", "state", "panacode", "service.json"),
  },
  {
    // panacode-windows workflow builds: OPENCODE_CHANNEL=prod with the run number. The CLI treats prod as a release
    // channel, so Desktop must poll service.json too (r9/r10 timed out polling the wrong file).
    version: "0.0.0-prod-3",
    expected: path.join("/home/ali", ".local", "state", "panacode", "service.json"),
  },
  {
    version: "0.0.0-prod-12.2",
    expected: path.join("/home/ali", ".local", "state", "panacode", "service.json"),
  },
  {
    version: "0.0.0-feature-x-7",
    expected: path.join("/home/ali", ".local", "state", "panacode", "service-feature-x.json"),
  },
  {
    version: "0.0.0-cursor-panacode-install-isolate-58f9-202611150802",
    expected: path.join(
      "/home/ali",
      ".local",
      "state",
      "panacode",
      "service-cursor-panacode-install-isolate-58f9.json",
    ),
  },
  {
    name: "absolute state root with spaces and non-ASCII",
    version: "2.3.0",
    stateHome,
    expected: path.join(stateHome, "panacode", "service.json"),
  },
  {
    name: "relative state root is ignored",
    version: "2.3.0",
    stateHome: "relative/state",
    expected: path.join("/home/ali", ".local", "state", "panacode", "service.json"),
  },
  {
    name: "local development channel",
    version: "2.3.0",
    local: true,
    expected: path.join("/home/ali", ".local", "state", "panacode", "service-local.json"),
  },
  {
    name: "local channel keeps a relative state root ignored",
    version: "2.3.0",
    stateHome: "relative/state",
    local: true,
    expected: path.join("/home/ali", ".local", "state", "panacode", "service-local.json"),
  },
])("cliServiceRegistrationFile: $name $version", ({ version, stateHome: state, local, expected }) => {
  expect(
    cliServiceRegistrationFile({
      join: path.join,
      home: "/home/ali",
      cliVersion: version,
      stateHome: state,
      local,
    }),
  ).toBe(expected)
})

const cli = path.join(import.meta.dir, "../../../../cli")

test.each([
  { name: "absolute XDG_STATE_HOME", xdg: path.join(os.tmpdir(), "panacode-parity", "state é") },
  { name: "relative XDG_STATE_HOME", xdg: "relative/state" },
  { name: "no XDG_STATE_HOME", xdg: undefined },
] as const)("registration file matches the CLI for $name", ({ xdg }) => {
  const env: Record<string, string> = { ...process.env, HOME: home, USERPROFILE: home }
  delete env.XDG_STATE_HOME
  if (xdg !== undefined) env.XDG_STATE_HOME = xdg

  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      "-e",
      'const { filename } = await import("./src/services/service-config.ts");' +
        'const { Global } = await import("@opencode/util/global");' +
        "console.log(JSON.stringify({ filename: filename(), state: Global.Path.state }))",
    ],
    cwd: cli,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })

  expect(result.exitCode, result.stderr.toString()).toBe(0)
  const output = JSON.parse(result.stdout.toString()) as { filename: string; state: string }
  expect(
    cliServiceRegistrationFile({
      join: path.join,
      home,
      cliVersion: "local",
      stateHome: xdg,
      local: true,
    }),
  ).toBe(path.join(output.state, output.filename))
})