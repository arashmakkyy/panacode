import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// configureApplication runs before Electron is ready and reads the real electron module, so the
// fixture runs in a child process with its own module mock. That keeps the app object, cwd and
// compile cache inside this test instead of the test runner.
test("uses the Panacode identity for userData and the single-instance lock", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-configure-"))

  try {
    const result = await run(path.join(root, "appData"), {})

    expect(result.names).toEqual(["Panacode Dev"])
    expect(result.userModelIDs).toEqual(["ai.panacode.desktop.dev"])
    expect(result.userData).toBe(path.join(root, "appData", "ai.panacode.desktop.dev"))
    expect(result.userDataPath).toBe(result.userData)
    // The lock is scoped to that userData directory. A second instance is refused and quit is called.
    expect(result.locks).toEqual([true, false])
    expect(result.quit).toBe(1)
    expect(result.disableWebUI).toBe("true")
    expect(result.switches).toContainEqual(["proxy-bypass-list", "<-loopback>"])
    expect(result.switches).toContainEqual([
      "enable-features",
      "DocumentPolicyIncludeJSCallStacksInCrashReports",
    ])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

// The desktop test root keeps every path inside the fixture. It is the supported way to run the
// real entry-point configuration without touching a user profile.
test("keeps the test root, session data and XDG roots inside the fixture", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-configure-root-"))

  try {
    const testRoot = path.join(root, "test-root")
    const result = await run(path.join(root, "appData"), { PANACODE_DESKTOP_TEST_ROOT: testRoot })

    expect(result.userData).toBe(path.join(testRoot, "desktop"))
    expect(result.sessionData).toBe(path.join(testRoot, "session"))
    expect(result.xdg).toEqual({
      PANACODE_DB: undefined,
      XDG_DATA_HOME: path.join(testRoot, "data"),
      XDG_CONFIG_HOME: path.join(testRoot, "config"),
      XDG_CACHE_HOME: path.join(testRoot, "cache"),
      XDG_STATE_HOME: path.join(testRoot, "state"),
    })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

function run(appData: string, extraEnv: Record<string, string>) {
  const script = `
import { mock } from "bun:test"

const calls = { names: [], userModelIDs: [], paths: [], switches: [], quit: 0, locks: [] }
const values = new Map([["appData", process.env.PANACODE_CONFIGURE_APP_DATA]])
const app = {
  isPackaged: false,
  getVersion: () => "0.0.0-test",
  setName: (name) => calls.names.push(name),
  setAppUserModelId: (id) => calls.userModelIDs.push(id),
  getPath: (name) => values.get(name),
  setPath: (name, value) => {
    values.set(name, value)
    calls.paths.push([name, value])
  },
  commandLine: {
    appendSwitch: (name, value) => calls.switches.push([name, value]),
    getSwitchValue: () => "",
    hasSwitch: () => false,
  },
  requestSingleInstanceLock: () => {
    const granted = calls.locks.length === 0
    calls.locks.push(granted)
    return granted
  },
  quit: () => calls.quit++,
}
mock.module("electron", () => ({ app }))

const { configureApplication, acquireApplicationLock } = await import(process.env.PANACODE_CONFIGURE_MODULE)
configureApplication()
const first = acquireApplicationLock()
const second = acquireApplicationLock()
console.log(JSON.stringify({
  names: calls.names,
  userModelIDs: calls.userModelIDs,
  userData: app.getPath("userData"),
  userDataPath: values.get("userData"),
  sessionData: values.get("sessionData"),
  switches: calls.switches,
  quit: calls.quit,
  locks: calls.locks,
  first,
  second,
  disableWebUI: process.env.PANACODE_DISABLE_EMBEDDED_WEB_UI,
  xdg: {
    PANACODE_DB: process.env.PANACODE_DB,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME,
  },
}))
`

  const child = Bun.spawn({
    cmd: [process.execPath, "-e", script],
    cwd: import.meta.dirname,
    env: {
      ...baseEnv(),
      PANACODE_CONFIGURE_APP_DATA: appData,
      PANACODE_CONFIGURE_MODULE: pathToFileURL(path.join(import.meta.dirname, "configure.ts")).href,
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  })

  return Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]).then(([stdout, stderr, code]) => {
    if (code !== 0) throw new Error(`configure fixture exited ${code}: ${stderr}`)
    const result = JSON.parse(stdout.trim())
    expect(result.first).toBe(true)
    expect(result.second).toBe(false)

    return result
  })
}

function baseEnv() {
  const env = { ...process.env }

  for (const key of [
    "PANACODE_DB",
    "PANACODE_DESKTOP_TEST_ROOT",
    "PANACODE_TEST_ONBOARDING",
    "PANACODE_DESKTOP_REMOTE_DEBUGGING_PORT",
    "XDG_DATA_HOME",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "OPENCODE_CHANNEL",
  ])
    delete env[key]

  return env
}