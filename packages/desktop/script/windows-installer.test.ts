import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { copyFile, cp, link, mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { INSTALL_MANIFEST, writeInstallManifest } from "./utils"
import { verifyWindowsPayload } from "./verify-windows-payload"

const windows = test.skipIf(process.platform !== "win32")

const appId = "ai.panacode.desktop"

const legacyDirectory = "@opencodedesktop"

const executable = "Panacode.exe"

const uninstaller = "Uninstall Panacode.exe"

const version = "2.3.0"

type Files = Record<string, string | Uint8Array>

async function harness() {
  const [windowsTools, nsisUtil, scriptGenerator, sevenZipTools] = await Promise.all([
    import("app-builder-lib/out/toolsets/windows"),
    import("app-builder-lib/out/targets/nsis/nsisUtil"),
    import("app-builder-lib/out/targets/nsis/nsisScriptGenerator"),
    import("app-builder-lib/out/toolsets/7zip"),
  ])

  const config = (await import("../electron-builder.config")).default
  const compiler = await windowsTools.getMakeNsisPath(config.toolsets?.nsis, config.nsis?.customNsisBinary)
  const plugins = await windowsTools.getNsisPluginsPath(config.toolsets?.nsis, config.nsis?.customNsisResources)
  const dir = await mkdtemp(path.join(os.tmpdir(), "panacode-installer-"))
  const registryKey = `Software\\PanacodeInstallerTest-${crypto.randomUUID()}`
  const shortcutName = `Panacode Installer Test ${crypto.randomUUID()}`
  // electron-builder generates the command-line flags such as ${isUpdated}.
  const flags = new scriptGenerator.NsisScriptGenerator()
  flags.flags(["updated"])

  const run = async (cmd: string[], env: Record<string, string> = {}, cwd?: string) => {
    const result = Bun.spawn(cmd, {
      cwd,
      env: { ...process.env, ...compiler.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    })

    const [stdout, stderr, code] = await Promise.all([
      new Response(result.stdout).text(),
      new Response(result.stderr).text(),
      result.exited,
    ])

    return { stdout: stdout.trim(), stderr: stderr.trim(), code }
  }

  const compile = async (
    name: string,
    body: string,
    options: { payload?: string; payloadHash?: string; pin?: string; footer?: string } = {},
  ) => {
    const script = path.join(dir, `${name}.nsi`)
    const exe = path.join(dir, `${name}.exe`)
    await Bun.write(
      script,
      `Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${exe}"
!addplugindir /x86-unicode "${path.join(plugins, "x86-unicode")}"
!addincludedir "${path.join(nsisUtil.nsisTemplatesDir, "include")}"
!include LogicLib.nsh
!include StdUtils.nsh
!include FileFunc.nsh
${flags.build()}
LoadLanguageFile "\${NSISDIR}\\Contrib\\Language files\\English.nlf"
LangString appRunning \${LANG_ENGLISH} "running"
LangString appClosing \${LANG_ENGLISH} "closing"
LangString appCannotBeClosed \${LANG_ENGLISH} "cannot close"
!define SHELL_CONTEXT HKCU
!define APP_ID "${appId}"
!define APP_FILENAME "${appId}"
!define BUILD_RESOURCES_DIR "${path.resolve(import.meta.dir, "../resources")}"
!define PANACODE_BUILD_SHA256 "${options.pin ?? "0".repeat(64)}"
!define APP_EXECUTABLE_FILENAME "${executable}"
!define UNINSTALL_FILENAME "${uninstaller}"
!define SHORTCUT_NAME "${shortcutName}"
!define VERSION "${version}"
!define INSTALL_REGISTRY_KEY "${registryKey}"
!define UNINSTALL_REGISTRY_KEY "${registryKey}"
!define APP_64 "${options.payload ?? path.join(dir, "unused.7z")}"
!define APP_64_HASH "${options.payloadHash ?? "0".repeat(64)}"
!define APP_64_UNPACKED_SIZE 1
!include "${config.nsis?.include}"
Section
${body}
SectionEnd
${options.footer ?? ""}
`,
    )
    const result = await run([compiler.path, script])
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0)
    // 6001 means a variable declared by the include is not used by this narrow harness section.
    // Every other warning number is a real defect, including the summary lines makensis prints.
    expect(
      result.stdout
        .split(/\r?\n/)
        .map((line) => line.match(/warning\s+(\d+):/))
        .filter((match) => match !== null && match[1] !== "6001"),
      "the installer include must compile without warnings",
    ).toEqual([])

    return exe
  }

  const registry = {
    clear: () => run(["reg.exe", "delete", `HKCU\\${registryKey}`, "/f"]),
    set: (name: string, value: string) =>
      run(["reg.exe", "add", `HKCU\\${registryKey}`, "/v", name, "/t", "REG_SZ", "/d", value, "/f"]),
    get: (name: string) => run(["reg.exe", "query", `HKCU\\${registryKey}`, "/v", name]),
    remove: (name: string) => run(["reg.exe", "delete", `HKCU\\${registryKey}`, "/v", name, "/f"]),
  }

  const result = async (name: string) => {
    const text = await readFile(path.join(dir, `result-${name}.txt`), "utf8").catch(() => "")

    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    )
  }

  const processEnvSystemRoot = process.env.SystemRoot ?? "C:\\Windows"
  const buildPins = new Map<string, string>()

  const install = async (exe: string, name: string, target?: string, args: string[] = []) => {
    const resultFile = path.join(dir, `result-${name}.txt`)
    await rm(resultFile, { force: true })

    const process = await run([exe, ...args, ...(target === undefined ? [] : [`/D=${target}`])], {
      PANACODE_TEST_RESULT: resultFile,
    })

    if (process.code >= 100 && process.code <= 132 && target && buildPins.has(exe)) {
      const parent = path.dirname(target)
      for (const entry of await readdir(parent, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/\.staging-\d+$/.test(entry.name)) continue
        const helper = path.resolve(import.meta.dir, "../resources/windows/install-files.ps1")
        const shell = path.join(processEnvSystemRoot, "SysWOW64/WindowsPowerShell/v1.0/powershell.exe")
        const check = await run([
          shell,
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          helper,
          "-Action",
          "Stage",
          "-Root",
          path.join(parent, entry.name),
          "-Pin",
          buildPins.get(exe)!,
          "-AppId",
          appId,
          "-Executable",
          executable,
        ])
        const category = /Panacode file verification: ([A-Za-z ]+)/.exec(check.stderr)?.[1] ?? "no category"
        console.error(`Read-only NSIS stage check (${name}): ${check.code}, ${category}`)
      }
    }
    return { ...process, result: await result(name) }
  }

  // A payload archive has to contain the app's files at its root, exactly like APP_64.
  const archive = async (payload: string, output: string) => {
    const sevenZip = await sevenZipTools.getPath7za()
    const result = await run([sevenZip, "a", "-t7z", "-mx=0", output, "*"], {}, payload)
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0)

    const hash = createHash("sha256")
      .update(await readFile(output))
      .digest("hex")
    return hash
  }

  const build = async (name: string, files: Files) => {
    const root = path.join(dir, name + "-payload")
    await writeFiles(root, files)
    const pin = await writeInstallManifest({ appDir: root, appId, version, executable })
    const payload = path.join(dir, name + ".7z")
    const payloadHash = await archive(root, payload)
    const exe = await compile(name, installBody, {
      pin,
      payload,
      payloadHash,
      footer: `Section "Uninstall"
  !insertmacro customRemoveFiles
  DeleteRegKey HKCU "${registryKey}"
SectionEnd
Function .onInit
  !insertmacro preInit
FunctionEnd`,
    })
    buildPins.set(exe, pin)
    return { root, pin, exe, suffix: ".update-" + payloadHash.slice(0, 16) }
  }

  return {
    dir,
    registryKey,
    shortcutName,
    run,
    compile,
    install,
    registry,
    build,
    cleanup: async () => {
      if (process.platform === "win32") await registry.clear()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

async function writeFiles(root: string, files: Files) {
  await Promise.all(
    Object.entries(files).map(async ([name, content]) => {
      const file = path.join(root, name)
      await mkdir(path.dirname(file), { recursive: true })
      await Bun.write(file, content)
    }),
  )
}

async function list(root: string) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name)

      return { name: path.relative(root, file).replaceAll("\\", "/"), file }
    })
    .toSorted((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
}

async function names(root: string) {
  return (await list(root)).map((entry) => entry.name)
}

async function entries(root: string) {
  return (await readdir(root, { withFileTypes: true }).catch(() => [])).map((entry) => entry.name).toSorted()
}

async function digest(root: string) {
  const hash = createHash("sha256")

  for (const entry of await list(root)) {
    hash.update(entry.name)
    hash.update("\0")
    hash.update(await readFile(entry.file))
    hash.update("\0")
  }

  return hash.digest("hex")
}

// A NSIS uninstaller relaunches itself from a temporary copy, so the process that Bun started can
// exit before the removal finishes. Wait for the expected tree and then for it to stay unchanged:
// a fixed stability window alone can observe the untouched tree before the copy even starts.
async function settle(read: () => Promise<string[]>, expected: readonly string[]) {
  const wanted = expected.join("\n")
  const deadline = Date.now() + 15_000

  while (Date.now() < deadline) {
    const current = await read()
    if (current.join("\n") === wanted) {
      // The relaunched copy may start after the parent exits; give it time to begin and finish
      // before trusting an unchanged tree.
      await Bun.sleep(2_000)
      const next = await read()
      if (next.join("\n") === wanted) return next
    }
    await Bun.sleep(100)
  }

  return read()
}

const installBody = `
  !insertmacro customInit
  !insertmacro customCheckAppRunning
  !insertmacro customInstallStagedApp
  WriteRegStr HKCU "\${INSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"
  WriteRegStr HKCU "\${UNINSTALL_REGISTRY_KEY}" UninstallString '"$INSTDIR\\${uninstaller}"'
  !insertmacro customInstall
`

const standard = { [executable]: "desktop", "resources/app.asar": "first" }

async function withHarness(fn: (h: Awaited<ReturnType<typeof harness>>) => Promise<void>) {
  const h = await harness()
  try {
    await fn(h)
  } finally {
    await h.cleanup()
  }
}

test(
  "makensis compiles installer, staging and uninstaller from the same pinned payload",
  () =>
    withHarness(async (h) => {
      const build = await h.build("compile", standard)
      const input = {
        installer: build.exe,
        buildPin: build.pin,
        appId,
        executable,
        version,
        helper: path.resolve(import.meta.dir, "../resources/windows/install-files.ps1"),
      }
      await verifyWindowsPayload(input)
      await expect(verifyWindowsPayload({ ...input, buildPin: "0".repeat(64) })).rejects.toThrow(
        "Archived manifest differs",
      )
    }),
  180_000,
)

windows(
  "fresh install and ordinary upgrade preserve changed files and retire the verified previous build",
  () =>
    withHarness(async (h) => {
      const old = await h.build("old", standard)
      const next = await h.build("new", { ...standard, "resources/app.asar": "next" })
      const root = path.join(h.dir, "app")
      expect((await h.install(old.exe, "old", root)).code).toBe(0)
      expect((await h.registry.get("PanacodeInstallReceipt")).stdout).toContain(old.pin)
      await writeFiles(root, { "notes.txt": "mine", "resources/app.asar": "other" })
      expect((await h.install(next.exe, "upgrade", root)).code).toBe(0)
      expect((await h.registry.get("PanacodeInstallReceipt")).stdout).toContain(next.pin)
      expect(await Bun.file(path.join(root, "resources/app.asar")).text()).toBe("next")
      expect(await names(root + ".old")).toEqual(["notes.txt", "resources/app.asar"])
      expect(await Bun.file(path.join(root + ".old", "resources/app.asar")).text()).toBe("other")
    }),
  180_000,
)

windows(
  "legacy migration keeps shared bytes, refuses a linked final destination and preserves registration on cancel",
  () =>
    withHarness(async (h) => {
      const next = await h.build("new", standard)
      const shared = path.join(h.dir, "programs", legacyDirectory)
      const target = path.join(h.dir, "programs", appId)
      const outside = path.join(h.dir, "outside")
      await writeFiles(outside, { sentinel: "keep" })
      await writeFiles(shared, { [executable]: "legacy", "OpenCode.exe": "foreign" })
      await h.registry.set("InstallLocation", shared)
      await h.registry.set("UninstallString", "old-uninstall")
      await h.registry.set("QuietUninstallString", "old-quiet")
      await symlink(outside, target, "junction")
      const before = await digest(shared)
      expect((await h.install(next.exe, "linked", shared)).code).toBe(55)
      expect(await names(outside)).toEqual(["sentinel"])
      expect((await h.registry.get("UninstallString")).stdout).toContain("old-uninstall")
      expect((await h.registry.get("QuietUninstallString")).stdout).toContain("old-quiet")
      await rm(target)
      expect((await h.install(next.exe, "migrate", shared)).code).toBe(0)
      expect(await digest(shared)).toBe(before)
      expect(await Bun.file(path.join(target, executable)).text()).toBe("desktop")
    }),
  180_000,
)

windows(
  "foreign and unregistered install trees are refused before files or registry change",
  () =>
    withHarness(async (h) => {
      const build = await h.build("new", standard)
      for (const name of ["marker-only", "copied-payload"]) {
        const root = path.join(h.dir, name)
        if (name === "copied-payload") await cp(build.root, root, { recursive: true })
        else await writeFiles(root, { [executable]: "foreign" })
        const before = await digest(root)
        expect((await h.install(build.exe, name, root)).code).toBe(58)
        expect(await digest(root)).toBe(before)
        expect((await h.registry.get("InstallLocation")).code).not.toBe(0)
      }
    }),
  180_000,
)

windows(
  "a pre-manifest image survives and only a receipt-verified running image is closed",
  () =>
    withHarness(async (h) => {
      const root = path.join(h.dir, "app")
      const file = path.join(root, executable)
      const ping = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "PING.EXE")
      await mkdir(root)
      await copyFile(ping, file)
      await h.registry.set("InstallLocation", root)
      const fixture = await h.compile("packaged-app", "  Sleep 60000")
      const build = await h.build("new", { ...standard, [executable]: await readFile(fixture) })
      const legacy = Bun.spawn([file, "-n", "60", "127.0.0.1"], { stdout: "ignore", stderr: "ignore" })
      try {
        expect((await h.install(build.exe, "legacy-running", root)).code).toBe(61)
        expect(legacy.exitCode).toBeNull()
      } finally {
        legacy.kill()
        await legacy.exited
      }
      expect((await h.install(build.exe, "install", root)).code).toBe(0)
      const aliasProbe = await h.compile(
        "short-install-path",
        `
      GetFullPathName /SHORT $0 "$INSTDIR"
      ReadEnvStr $1 "PANACODE_TEST_RESULT"
      FileOpen $2 "$1" w
      FileWrite $2 "short=$0$\\r$\\n"
      FileClose $2`,
      )
      const alias = (await h.install(aliasProbe, "alias", root)).result.short
      expect(alias).toBeTruthy()
      const unrelated = Bun.spawn([fixture], { stdout: "ignore", stderr: "ignore" })
      const owned = Bun.spawn([file], { stdout: "ignore", stderr: "ignore" })
      try {
        expect((await h.install(build.exe, "verified", alias)).code).toBe(0)
        expect(await owned.exited).toBe(1)
        expect(unrelated.exitCode).toBeNull()
      } finally {
        unrelated.kill()
        if (owned.exitCode === null) owned.kill()
        await Promise.all([unrelated.exited, owned.exited])
      }
    }),
  180_000,
)

windows(
  "stage preparation reuses only a complete unchanged build and activation ignores an altered stage",
  () =>
    withHarness(async (h) => {
      const old = await h.build("old", standard)
      const next = await h.build("next", { ...standard, "resources/app.asar": "next" })
      const root = path.join(h.dir, "app")
      const stage = root + next.suffix
      expect((await h.install(old.exe, "old", root)).code).toBe(0)
      expect((await h.run([next.exe, "--stage"])).code).toBe(0)
      expect(await digest(stage)).toBe(await digest(next.root))
      expect((await h.run([next.exe, "--stage"])).code).toBe(0)
      await writeFiles(stage, { "resources/app.asar": "edit", "unlisted.dll": "mine" })
      const before = await digest(stage)
      expect((await h.run([next.exe, "--stage"])).code).toBe(2)
      expect((await h.install(next.exe, "upgrade", root)).code).toBe(0)
      expect(await digest(stage)).toBe(before)
      expect(await names(root)).not.toContain("unlisted.dll")
      expect(await Bun.file(path.join(root, "resources/app.asar")).text()).toBe("next")
      await rm(stage, { recursive: true })
      expect((await h.run([next.exe, "--stage"])).code).toBe(0)
      expect((await h.install(next.exe, "verified-stage", root)).code).toBe(0)
      expect(await entries(h.dir)).not.toContain(path.basename(stage))
    }),
  180_000,
)

windows(
  "uninstall retains same-length replacements and leaves all sibling trees and junctions intact",
  () =>
    withHarness(async (h) => {
      const build = await h.build("new", standard)
      const root = path.join(h.dir, "app")
      const outside = path.join(h.dir, "outside")
      expect((await h.install(build.exe, "install", root)).code).toBe(0)
      await writeFiles(root, { "resources/app.asar": "other", "private.txt": "keep" })
      await cp(build.root, outside, { recursive: true })
      await writeFiles(outside, { [uninstaller]: "outside", "uninstallerIcon.ico": "outside" })
      await symlink(outside, root + ".old", "junction")
      await symlink(outside, root + build.suffix, "junction")
      const before = await digest(outside)
      expect((await h.run([path.join(root, uninstaller), "/S"])).code).toBe(0)
      const kept = ["private.txt", "resources/app.asar"]
      expect(await settle(() => names(root), kept)).toEqual(kept)
      expect(await digest(outside)).toBe(before)
    }),
  180_000,
)

windows(
  "an untrusted manifest stops deletion even when its modified file has the stated digest",
  () =>
    withHarness(async (h) => {
      const build = await h.build("new", standard)
      const root = path.join(h.dir, "app")
      expect((await h.install(build.exe, "install", root)).code).toBe(0)
      await writeFiles(root, { "mine.txt": "keep" })
      await writeInstallManifest({ appDir: root, appId, version, executable })
      const before = await digest(root)
      // _?= runs the uninstall section synchronously instead of returning from a launcher copy.
      expect((await h.run([path.join(root, uninstaller), "/S", "_?=" + root])).code).toBe(59)
      expect(await digest(root)).toBe(before)
    }),
  180_000,
)

windows(
  "uninstall preserves the receipt after a hard-linked manifest or a file-sharing failure and can retry",
  () =>
    withHarness(async (h) => {
      const build = await h.build("new", standard)
      const root = path.join(h.dir, "app")
      expect((await h.install(build.exe, "install", root)).code).toBe(0)
      const manifest = path.join(root, INSTALL_MANIFEST)
      const alias = path.join(h.dir, "linked-manifest")
      const remove = path.join(root, uninstaller)
      await link(manifest, alias)
      expect((await h.run([remove, "/S", "_?=" + root])).code).toBe(83)
      expect((await h.registry.get("PanacodeInstallReceipt")).stdout).toContain(build.pin)
      expect(await names(root)).toContain("resources/app.asar")
      await rm(alias)

      const hold = `
        $ErrorActionPreference = 'Stop'
        $handle = [IO.File]::Open($env:PANACODE_TEST_HELD, 'Open', 'Read', 'Read')
        try {
          $p = Start-Process -PassThru -Wait -FilePath $env:PANACODE_TEST_REMOVE -ArgumentList ('/S _?=' + $env:PANACODE_TEST_ROOT)
          exit $p.ExitCode
        } finally { $handle.Dispose() }
      `
      const locked = await h.run(["powershell.exe", "-NoProfile", "-Command", hold], {
        PANACODE_TEST_HELD: path.join(root, "resources/app.asar"),
        PANACODE_TEST_REMOVE: remove,
        PANACODE_TEST_ROOT: root,
      })
      expect(locked.code, locked.stderr).toBe(83)
      expect(await Bun.file(manifest).exists()).toBe(true)
      expect((await h.registry.get("PanacodeInstallReceipt")).stdout).toContain(build.pin)
      expect((await h.run([remove, "/S"])).code).toBe(0)
      expect(await settle(() => names(root), [])).toEqual([])
      expect((await h.registry.get("PanacodeInstallReceipt")).code).not.toBe(0)
    }),
  180_000,
)

windows(
  "the sandbox read/execute grant applies only to the new install tree",
  () =>
    withHarness(async (h) => {
      const build = await h.build("new", standard)
      const root = path.join(h.dir, "app")
      const sibling = path.join(h.dir, "outside.txt")
      await Bun.write(sibling, "outside")
      const acl = async (target: string) => {
        const result = await h.run(
          ["powershell.exe", "-NoProfile", "-Command", "(Get-Acl -LiteralPath $env:PANACODE_TEST_PATH).Sddl"],
          { PANACODE_TEST_PATH: target },
        )
        expect(result.code).toBe(0)
        return result.stdout
      }
      const before = await acl(sibling)
      expect((await h.install(build.exe, "install", root)).code).toBe(0)
      expect(await acl(path.join(root, "resources/app.asar"))).toContain("S-1-15-2-2")
      expect(await acl(sibling)).toBe(before)
    }),
  180_000,
)
