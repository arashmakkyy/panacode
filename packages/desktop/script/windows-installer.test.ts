import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { INSTALL_MANIFEST, writeInstallManifest } from "./utils"

const windows = test.skipIf(process.platform !== "win32")

const appId = "ai.panacode.desktop"

const appFilename = "@opencodedesktop"

const executable = "Panacode.exe"

const uninstaller = "Uninstall Panacode.exe"

const version = "2.3.0"

const payloadHash = "0123456789ABCDEF0123456789ABCDEF"

const stageSuffix = payloadHash.slice(0, 16)

const updateStage = `update-${stageSuffix}`

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
    options: { payload?: string; payloadHash?: string; payloadSize?: number; footer?: string } = {},
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
!define APP_FILENAME "${appFilename}"
!define APP_EXECUTABLE_FILENAME "${executable}"
!define UNINSTALL_FILENAME "${uninstaller}"
!define SHORTCUT_NAME "${shortcutName}"
!define VERSION "${version}"
!define INSTALL_REGISTRY_KEY "${registryKey}"
!define UNINSTALL_REGISTRY_KEY "${registryKey}"
!define APP_64 "${options.payload ?? path.join(dir, "unused.7z")}"
!define APP_64_HASH "${options.payloadHash ?? payloadHash}"
!define APP_64_UNPACKED_SIZE ${options.payloadSize ?? 1}
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

  const install = async (exe: string, name: string, target?: string, args: string[] = []) => {
    const resultFile = path.join(dir, `result-${name}.txt`)
    await rm(resultFile, { force: true })

    const process = await run([exe, ...args, ...(target === undefined ? [] : [`/D=${target}`])], {
      PANACODE_TEST_RESULT: resultFile,
    })

    return { ...process, result: await result(name) }
  }

  // A payload archive has to contain the app's files at its root, exactly like APP_64.
  const archive = async (payload: string, output: string) => {
    const sevenZip = await sevenZipTools.getPath7za()
    const result = await run([sevenZip, "a", "-t7z", "-mx=0", output, "*"], {}, payload)
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0)

    const hash = createHash("sha256").update(await readFile(output)).digest("hex")
    const size = (await list(payload)).reduce((total, file) => total + file.size, 0)

    return { hash, size: Math.ceil(size / 1024) }
  }

  return {
    dir,
    registryKey,
    shortcutName,
    run,
    compile,
    install,
    registry,
    archive,
    cleanup: async () => {
      await registry.clear()
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

async function writeOwned(root: string, files: Files) {
  await writeFiles(root, files)
  await writeInstallManifest({ appDir: root, appId, version, executable })
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
  return (await readdir(root, { withFileTypes: true }).catch(() => []))
    .map((entry) => entry.name)
    .toSorted()
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

async function content(root: string, name: string) {
  return readFile(path.join(root, name))
}

// A NSIS uninstaller relaunches itself from a temporary copy, so the process that Bun started can
// exit before the removal finishes. Wait until the directory listing stops changing.
async function settle(read: () => Promise<string[]>) {
  let previous = await read()

  for (let attempt = 0; attempt < 50; attempt++) {
    await Bun.sleep(100)
    const next = await read()

    if (next.join("\n") === previous.join("\n")) return next
    previous = next
  }

  return previous
}

// The include's result contract: each test body ends with this trailer when it needs to report $INSTDIR.
const report = `
  ReadEnvStr $2 "PANACODE_TEST_RESULT"
  \${If} $2 != ""
    FileOpen $3 "$2" w
    FileWrite $3 "INSTDIR=$INSTDIR$\\r$\\n"
    FileWrite $3 "SHARED=$panacodeShared$\\r$\\n"
    FileWrite $3 "SHAREDOWNED=$panacodeSharedOwned$\\r$\\n"
    FileWrite $3 "VERIFIED=$panacodeVerified$\\r$\\n"
    FileWrite $3 "RESULT=$R0$\\r$\\n"
    FileClose $3
  \${EndIf}`

const initBody = `  !insertmacro customInit
${report}`

const installBody = `  !insertmacro customInit
  !insertmacro customInstall
${report}`

// The installer's decisions are table rows: one compile, many fixtures. A refusal exits 5 before
// writing a result, so every refusal case also proves that the foreign tree stayed untouched.
const initCases = [
  { name: "fresh-shared-name", target: "@opencodedesktop", expected: "ai.panacode.desktop", code: 0 },
  { name: "fresh-custom", target: "custom", expected: "custom", code: 0 },
  {
    name: "owned-install",
    target: "owned",
    expected: "owned",
    code: 0,
    verified: "1",
    registry: "target",
    manifest: true,
  },
  {
    name: "pre-manifest-install",
    target: "pre-manifest",
    expected: "pre-manifest",
    code: 0,
    verified: "0",
    registry: "target",
    files: { [executable]: "old" },
  },
  { name: "foreign-files", target: "foreign", expected: "foreign", code: 5, files: { "foreign.txt": "keep" } },
  {
    name: "different-existing-install",
    target: "different",
    expected: "different",
    code: 5,
    registry: "other",
    other: { "foreign.txt": "keep" },
  },
  { name: "profile", target: process.env.USERPROFILE ?? "", expected: "", code: 5 },
  { name: "drive-root", target: path.parse(os.tmpdir()).root, expected: "", code: 5 },
]

windows(
  "installs only into an owned or empty directory",
  async () => {
    const installer = await harness()

    try {
      const exe = await installer.compile("init", initBody)

      for (const item of initCases) {
        await installer.registry.clear()
        const root = path.join(installer.dir, item.name)
        const target = path.isAbsolute(item.target) ? item.target : path.join(root, item.target)

        if (item.manifest) await writeOwned(target, { [executable]: "old" })
        else if (item.files) await writeFiles(target, item.files)

        if (item.registry === "target") await installer.registry.set("InstallLocation", target)

        if (item.other) {
          const other = path.join(root, "other")
          await writeFiles(other, item.other)
          await installer.registry.set("InstallLocation", other)
        }

        const before = await digest(root)

        const result = await installer.install(exe, item.name, target)

        expect(result.code, item.name).toBe(item.code)

        if (item.code !== 0) {
          expect(await digest(root), item.name).toBe(before)
          continue
        }

        expect(result.result.INSTDIR, item.name).toBe(path.join(root, item.expected))

        if (item.verified) expect(result.result.VERIFIED, item.name).toBe(item.verified)
      }
    } finally {
      await installer.cleanup()
    }
  },
  180_000,
)

// The old shared directory is this app's only when its own registry entry points at it. Its unknown
// files are never deleted, and a manifest-verified file is deleted only while its size still matches.
const sharedCases = [
  {
    name: "manifest-owned-shared",
    owned: { [executable]: "exe", "resources/app.asar": "asar", "resources/nested/helper.dll": "dll" },
    foreign: { "marker.txt": "keep", "Panacode Beta.exe": "beta", "resources/beta.asar": "beta" },
    expected: {
      left: ["Panacode Beta.exe", "marker.txt", "resources/beta.asar"],
      shared: "shared",
    },
  },
  {
    name: "legacy-shared-zero-exe",
    foreign: { "marker.txt": "keep", "Panacode Beta.exe": "beta", "resources/beta.asar": "beta" },
    expected: {
      left: ["Panacode Beta.exe", "marker.txt", "resources/beta.asar"],
      shared: "shared",
    },
  },
  {
    name: "shared-other-exe",
    foreign: { "Panacode Beta.exe": "beta" },
    expected: {
      left: ["Panacode Beta.exe"],
      shared: "shared",
    },
  },
  {
    name: "changed-size-is-kept",
    owned: { "owned.dll": "old", "Panacode.exe": "exe" },
    changed: { "owned.dll": "changed" },
    foreign: { "marker.txt": "keep" },
    expected: {
      left: ["marker.txt", "owned.dll"],
      shared: "shared",
    },
  },
]

windows(
  "removes only the shared files this build proves",
  async () => {
    const installer = await harness()

    try {
      const exe = await installer.compile("shared", installBody)

      for (const item of sharedCases) {
        await installer.registry.clear()
        const root = path.join(installer.dir, item.name)
        const shared = path.join(root, appFilename)

        if (item.owned) await writeOwned(shared, item.owned)
        else await mkdir(shared, { recursive: true })

        if (item.foreign) await writeFiles(shared, item.foreign)

        if (item.changed) await writeFiles(shared, item.changed)

        const foreignBefore = await Promise.all(
          Object.keys(item.foreign ?? {}).map(async (name) => [name, await content(shared, name)] as const),
        )

        await installer.registry.set("InstallLocation", shared)
        const result = await installer.install(exe, item.name, shared)

        expect(result.code, item.name).toBe(0)
        expect(result.result.INSTDIR, item.name).toBe(path.join(root, appId))
        expect(result.result.SHARED, item.name).toBe(shared)
        expect(result.result.SHAREDOWNED, item.name).toBe(item.owned ? "1" : "0")
        expect(await names(shared), item.name).toEqual(item.expected.left.toSorted())

        for (const [name, bytes] of foreignBefore) expect(await content(shared, name), name).toEqual(bytes)

        if (item.owned) {
          expect(await names(shared), item.name).not.toContain(INSTALL_MANIFEST)
          expect(await names(shared), item.name).not.toContain("resources/nested/helper.dll")
        }
      }
    } finally {
      await installer.cleanup()
    }
  },
  180_000,
)

// The sandbox SID is granted to the installation directory only. An unrelated ACE on the same tree,
// the parent and a sibling file keep their exact SDDL, and a second run is idempotent.
windows(
  "grants the sandbox access only to its own installation",
  async () => {
    const installer = await harness()

    try {
      const root = path.join(installer.dir, "acl")
      const install = path.join(root, "app")
      await writeFiles(root, { "unrelated.txt": "outside the installation" })
      await writeFiles(install, { "resources/icudtl.dat": "runtime fixture" })
      await installer.registry.set("InstallLocation", install)

      const acl = async (target: string) => {
        const result = await installer.run(
          [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-Acl -LiteralPath $env:PANACODE_TEST_PATH).Sddl",
          ],
          { PANACODE_TEST_PATH: target },
        )

        expect(result.code, result.stderr).toBe(0)

        return result.stdout.trim()
      }

      const grant = await installer.run([
        "icacls.exe",
        install,
        "/grant",
        "*S-1-15-2-999-999-999:(OI)(CI)(F)",
      ])

      expect(grant.code, grant.stderr).toBe(0)
      const parent = await acl(root)
      const unrelated = await acl(path.join(root, "unrelated.txt"))

      const exe = await installer.compile("acl", "  !insertmacro customInstall")
      expect((await installer.install(exe, "acl", install)).code).toBe(0)
      const installed = await acl(path.join(install, "resources/icudtl.dat"))
      expect(installed).toContain("(A;ID;0x1200a9;;;S-1-15-2-2)")
      expect(installed).toContain("S-1-15-2-999-999-999")
      expect((await installer.install(exe, "acl-again", install)).code).toBe(0)
      expect(await acl(path.join(install, "resources/icudtl.dat"))).toBe(installed)
      expect(await acl(root)).toBe(parent)
      expect(await acl(path.join(root, "unrelated.txt"))).toBe(unrelated)
    } finally {
      await installer.cleanup()
    }
  },
  180_000,
)

// A process is stopped only when its verified image is this installation's executable. A sibling
// with the same file name, a helper inside the tree and a pre-manifest shared executable stay alive.
windows(
  "stops only the executable that belongs to this installation",
  async () => {
    const installer = await harness()
    const ping = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "PING.EXE")

    try {
      const exe = await installer.compile("running", `  !insertmacro customInit
  !insertmacro customCheckAppRunning
${report}`)

      const spawn = (file: string, pings: number) =>
        Bun.spawn([file, "-n", String(pings), "127.0.0.1"], { stdout: "ignore", stderr: "ignore" })

      {
        await installer.registry.clear()
        const install = path.join(installer.dir, "manual", "app")
        await mkdir(install, { recursive: true })
        await copyFile(ping, path.join(install, executable))
        await installer.registry.set("InstallLocation", install)
        const app = spawn(path.join(install, executable), 30)

        try {
          const started = performance.now()
          const result = await installer.install(exe, "manual", install)
          expect(result.code).toBe(0)
          expect(await app.exited).toBe(1)
          expect(performance.now() - started).toBeLessThan(5_000)
        } finally {
          app.kill()
          await app.exited
        }
      }

      {
        await installer.registry.clear()
        const root = path.join(installer.dir, "lookalike")
        const install = path.join(root, "app")
        const sibling = path.join(root, "sibling")
        await mkdir(install, { recursive: true })
        await mkdir(sibling, { recursive: true })
        await copyFile(ping, path.join(install, "helper.exe"))
        await copyFile(ping, path.join(sibling, executable))
        await writeInstallManifest({ appDir: install, appId, version, executable })
        const helper = spawn(path.join(install, "helper.exe"), 30)
        const other = spawn(path.join(sibling, executable), 30)

        try {
          expect((await installer.install(exe, "lookalike", install)).code).toBe(0)
          expect(helper.exitCode).toBeNull()
          expect(other.exitCode).toBeNull()
        } finally {
          helper.kill()
          other.kill()
          await Promise.all([helper.exited, other.exited])
        }
      }

      {
        await installer.registry.clear()
        const root = path.join(installer.dir, "shared-legacy")
        const shared = path.join(root, appFilename)
        await mkdir(shared, { recursive: true })
        await copyFile(ping, path.join(shared, executable))
        await installer.registry.set("InstallLocation", shared)
        const app = spawn(path.join(shared, executable), 30)

        try {
          const result = await installer.install(exe, "shared-legacy", shared)
          expect(result.code).toBe(0)
          expect(result.result.SHAREDOWNED).toBe("0")
          expect(app.exitCode).toBeNull()
        } finally {
          app.kill()
          await app.exited
        }
      }

      {
        await installer.registry.clear()
        const root = path.join(installer.dir, "shared-owned")
        const shared = path.join(root, appFilename)
        await mkdir(shared, { recursive: true })
        await copyFile(ping, path.join(shared, executable))
        await writeInstallManifest({ appDir: shared, appId, version, executable })
        await installer.registry.set("InstallLocation", shared)
        const app = spawn(path.join(shared, executable), 30)

        try {
          expect((await installer.install(exe, "shared-owned", shared)).code).toBe(0)
          expect(await app.exited).toBe(1)
        } finally {
          app.kill()
          await app.exited
        }
      }

      {
        await installer.registry.clear()
        const install = path.join(installer.dir, "updated", "app")
        await mkdir(install, { recursive: true })
        await copyFile(ping, path.join(install, executable))
        await installer.registry.set("InstallLocation", install)
        const app = spawn(path.join(install, executable), 30)

        try {
          const started = performance.now()
          expect((await installer.install(exe, "updated", install, ["--updated"])).code).toBe(0)
          // An update gives the running app the full ten-second grace period before stopping it.
          expect(performance.now() - started).toBeGreaterThanOrEqual(9_500)
          expect(await app.exited).toBe(1)
        } finally {
          app.kill()
          await app.exited
        }
      }
    } finally {
      await installer.cleanup()
    }
  },
  240_000,
)

// A staged directory is taken only when its manifest names this app, version and executable, and
// only when the current directory is either empty or fully proven by its own manifest.
const stagedCases = [
  {
    name: "moves-into-empty",
    staged: { [executable]: "new", "resources/app.asar": "new" },
    expected: "installed",
    left: [INSTALL_MANIFEST, executable, "resources/app.asar"],
    leftovers: [],
  },
  {
    name: "replaces-owned",
    owned: { [executable]: "old", "resources/app.asar": "old" },
    staged: { [executable]: "new", "resources/app.asar": "new" },
    expected: "installed",
    left: [INSTALL_MANIFEST, executable, "resources/app.asar"],
    leftovers: [],
  },
  {
    name: "keeps-unknown-files",
    owned: { [executable]: "old" },
    foreign: { "keep.me": "keep" },
    staged: { [executable]: "new" },
    expected: "installed",
    left: [INSTALL_MANIFEST, executable],
    leftovers: ["keep.me"],
  },
  {
    name: "keeps-pre-manifest-install",
    preManifest: { [executable]: "old", "foreign.txt": "keep" },
    staged: { [executable]: "new" },
    expected: "",
    left: [executable, "foreign.txt"],
    leftovers: [],
  },
  {
    name: "ignores-another-payload",
    stagedName: "update-FEDCBA9876543210",
    staged: { [executable]: "new" },
    expected: "",
    left: [],
    leftovers: [],
  },
  {
    name: "ignores-a-wrong-app",
    staged: { [executable]: "new" },
    wrongApp: true,
    expected: "",
    left: [],
    leftovers: [],
  },
]

windows(
  "takes only the staged directory that belongs to this build",
  async () => {
    const installer = await harness()

    try {
      const exe = await installer.compile(
        "staged",
        `  !insertmacro customInit
  InitPluginsDir
  !insertmacro customInstallStagedApp
  \${If} $R0 == "installed"
    SetErrorLevel 0
  \${Else}
    SetErrorLevel 3
  \${EndIf}
${report}`,
      )

      for (const item of stagedCases) {
        await installer.registry.clear()
        const root = path.join(installer.dir, item.name)
        const install = path.join(root, "app")
        const stage = path.join(`${install}.${item.stagedName ?? updateStage}`)
        await mkdir(install, { recursive: true })

        if (item.preManifest) {
          await writeFiles(install, item.preManifest)
          await installer.registry.set("InstallLocation", install)
        } else if (item.owned) {
          await writeOwned(install, item.owned)
          await installer.registry.set("InstallLocation", install)
        }

        if (item.foreign) await writeFiles(install, item.foreign)
        await writeFiles(stage, item.staged)
        await writeInstallManifest({
          appDir: stage,
          appId: item.wrongApp ? "ai.other.desktop" : appId,
          version,
          executable,
        })
        const stageBefore = await digest(stage)

        const result = await installer.install(exe, item.name, install)

        expect(result.code, item.name).toBe(item.expected === "installed" ? 0 : 3)
        expect(result.result.RESULT, item.name).toBe(item.expected)
        expect(await names(install), item.name).toEqual(item.left.toSorted())

        if (item.expected === "installed") {
          expect(await entries(root), item.name).not.toContain(`app.${updateStage}`)
          expect(await names(`${install}.old`), item.name).toEqual(item.leftovers.toSorted())
        } else {
          expect(await digest(stage), item.name).toBe(stageBefore)
        }
      }
    } finally {
      await installer.cleanup()
    }
  },
  180_000,
)

// The preInstall --stage path builds a real 7z from the production manifest writer and proves it
// stages beside the private install directory, never inside the old shared one.
windows(
  "stages an update only beside a verified installation",
  async () => {
    const installer = await harness()

    try {
      const payload = path.join(installer.dir, "payload")
      await writeFiles(payload, { [executable]: "new", "resources/app.asar": "new" })
      await writeInstallManifest({ appDir: payload, appId, version, executable })
      const archive = path.join(installer.dir, "payload.7z")
      const packed = await installer.archive(payload, archive)

      const exe = await installer.compile("stage", "  !insertmacro preInit", {
        payload: archive,
        payloadHash: packed.hash,
        payloadSize: packed.size,
      })

      const suffix = packed.hash.slice(0, 16)
      const stagedName = `update-${suffix}`

      {
        await installer.registry.clear()
        const root = path.join(installer.dir, "stage-private")
        const install = path.join(root, "app")
        await writeOwned(install, { [executable]: "old" })
        await installer.registry.set("InstallLocation", install)
        const before = await digest(install)

        const result = await installer.run([exe, "--stage"])
        expect(result.code).toBe(0)
        expect(await entries(root)).toContain(`app.${stagedName}`)
        expect(await names(path.join(`${install}.${stagedName}`))).toEqual(
          [INSTALL_MANIFEST, executable, "resources/app.asar"].toSorted(),
        )
        expect(await digest(install)).toBe(before)
        expect((await entries(root)).filter((name) => name.includes(".staging-"))).toEqual([])
      }

      {
        await installer.registry.clear()
        const root = path.join(installer.dir, "stage-shared")
        const shared = path.join(root, appFilename)
        await writeOwned(shared, { [executable]: "old", "resources/app.asar": "old" })
        await writeFiles(shared, { "marker.txt": "keep" })
        await installer.registry.set("InstallLocation", shared)
        const before = await digest(shared)

        const result = await installer.run([exe, "--stage"])
        expect(result.code).toBe(0)
        expect(await entries(root)).toContain(`${appId}.${stagedName}`)
        expect(await digest(shared)).toBe(before)
        expect((await entries(root)).filter((name) => name.includes(".staging-"))).toEqual([])
      }

      {
        await installer.registry.clear()
        const root = path.join(installer.dir, "stage-unrecorded")
        await mkdir(path.join(root, "app"), { recursive: true })

        const result = await installer.run([exe, "--stage"])
        expect(result.code).toBe(2)
        expect(await entries(root)).toEqual(["app"])
      }

      {
        // A foreign stage with the same name is never overwritten or reused.
        await installer.registry.clear()
        const root = path.join(installer.dir, "stage-foreign")
        const install = path.join(root, "app")
        await writeOwned(install, { [executable]: "old" })
        const stage = path.join(`${install}.update-${suffix}`)
        await writeFiles(stage, { "foreign.txt": "keep" })
        await installer.registry.set("InstallLocation", install)
        const before = await digest(stage)
        const result = await installer.run([exe, "--stage"])
        expect(result.code).toBe(2)
        expect(await digest(stage)).toBe(before)
        expect((await names(root)).filter((name) => name.includes(".staging-"))).toEqual([])
      }

      {
        // A stage that belongs to this exact build is reused without rewriting it.
        await installer.registry.clear()
        const root = path.join(installer.dir, "stage-reuse")
        const install = path.join(root, "app")
        await writeOwned(install, { [executable]: "old" })
        const stage = path.join(`${install}.update-${suffix}`)
        await writeOwned(stage, { [executable]: "new", "staged.txt": "keep" })
        await installer.registry.set("InstallLocation", install)
        const before = await digest(stage)
        const result = await installer.run([exe, "--stage"])
        expect(result.code).toBe(0)
        expect(await digest(stage)).toBe(before)
      }
    } finally {
      await installer.cleanup()
    }
  },
  240_000,
)

// The standard uninstaller calls customRemoveFiles instead of its recursive removal. It removes an
// exact tree only while the manifest and registry agree, and it never touches a foreign tree.
windows(
  "uninstalls only a manifest-verified installation",
  async () => {
    const installer = await harness()

    try {
      const exe = await installer.compile("uninstall", `  WriteUninstaller "$INSTDIR\\${uninstaller}"`, {
        footer: `Section "Uninstall"
  !insertmacro customRemoveFiles
SectionEnd`,
      })

      const cases = [
        {
          name: "verified",
          manifest: true,
          match: true,
          remove: true,
          left: ["foreign.txt"],
          stageLeft: [],
        },
        {
          name: "registry-mismatch",
          manifest: true,
          match: false,
          remove: false,
          left: [INSTALL_MANIFEST, executable, "foreign.txt", "resources/app.asar", uninstaller],
          stageLeft: [INSTALL_MANIFEST, executable],
        },
        {
          name: "no-manifest",
          manifest: false,
          match: true,
          remove: false,
          left: [executable, "foreign.txt", "resources/app.asar", uninstaller],
          stageLeft: [INSTALL_MANIFEST, executable],
        },
      ]

      for (const item of cases) {
        await installer.registry.clear()
        const root = path.join(installer.dir, `uninstall-${item.name}`)
        const install = path.join(root, "app")

        if (item.manifest) await writeOwned(install, { [executable]: "old", "resources/app.asar": "old" })
        else await writeFiles(install, { [executable]: "old", "resources/app.asar": "old" })
        await writeFiles(install, { "foreign.txt": "keep" })
        await installer.registry.set("InstallLocation", item.match ? install : path.join(root, "elsewhere"))
        // The same build's stage is owned; a differently named sibling is not.
        await writeOwned(path.join(`${install}.update-${stageSuffix}`), { [executable]: "staged" })
        await writeOwned(path.join(`${install}.update-FEDCBA9876543210`), { [executable]: "other" })

        expect((await installer.run([exe, `/D=${install}`])).code, item.name).toBe(0)
        const created = path.join(install, uninstaller)
        expect((await stat(created).catch(() => undefined))?.isFile(), item.name).toBe(true)
        expect((await installer.run([created, "/S"])).code, item.name).toBe(0)
        const left = await settle(() => names(install))

        if (item.remove) {
          expect(left, item.name).toEqual(item.left.toSorted())
          expect(await settle(() => names(path.join(`${install}.update-${stageSuffix}`))), item.name).toEqual([])
          expect(await names(path.join(`${install}.update-FEDCBA9876543210`)), item.name).toEqual(
            [INSTALL_MANIFEST, executable].toSorted(),
          )
        } else {
          expect(left, item.name).toEqual(item.left.toSorted())
          expect(await names(path.join(`${install}.update-${stageSuffix}`)), item.name).toEqual(
            item.stageLeft.toSorted(),
          )
        }
      }

      {
        // customInit runs in .onInit, before the stock section's uninstallOldVersion step. Removing
        // both registry values there is what stops the old uninstaller from running at all.
        await installer.registry.clear()
        const init = await installer.compile("init-old-uninstaller", initBody)
        const root = path.join(installer.dir, "uninstall-old")
        const install = path.join(root, "app")
        await writeFiles(install, { [executable]: "old" })
        await installer.registry.set("InstallLocation", install)
        await installer.registry.set("UninstallString", `"${path.join(install, uninstaller)}"`)
        await installer.registry.set("QuietUninstallString", `"${path.join(install, uninstaller)}" /S`)
        const result = await installer.install(init, "uninstall-old", install)
        expect(result.code).toBe(0)
        expect((await installer.registry.get("UninstallString")).code).not.toBe(0)
        expect((await installer.registry.get("QuietUninstallString")).code).not.toBe(0)
      }
    } finally {
      await installer.cleanup()
    }
  },
  240_000,
)

// A second channel's registry entry and the user's pinned taskbar folder must be byte-identical
// after this channel installs. The pinned folder is only read; this app's shortcut name is a unique
// test name, so nothing in the user's real taskbar matches it.
windows(
  "does not touch another channel's registration or shortcuts",
  async () => {
    const installer = await harness()
    const other = `Software\\PanacodeInstallerTest-Other-${crypto.randomUUID()}`

    try {
      const root = path.join(installer.dir, "channels")
      const install = path.join(root, "app")
      await writeOwned(install, { [executable]: "old" })
      await installer.registry.set("InstallLocation", install)

      const otherValues = [
        ["DisplayName", "Panacode Beta"],
        ["InstallLocation", path.join(root, "beta")],
        ["UninstallString", "beta-uninstall"],
        ["QuietUninstallString", "beta-uninstall /S"],
      ] as const

      for (const [name, value] of otherValues) {
        const added = await installer.run([
          "reg.exe",
          "add",
          `HKCU\\${other}`,
          "/v",
          name,
          "/t",
          "REG_SZ",
          "/d",
          value,
          "/f",
        ])

        expect(added.code, added.stderr).toBe(0)
      }

      const query = () =>
        installer.run(["reg.exe", "query", `HKCU\\${other}`, "/s"]).then((result) => result.stdout)

      const before = await query()

      const pinned = path.join(
        process.env.APPDATA ?? "",
        "Microsoft",
        "Internet Explorer",
        "Quick Launch",
        "User Pinned",
        "TaskBar",
      )

      const pinnedFiles = async () =>
        (await readdir(pinned, { recursive: true, withFileTypes: true }).catch(() => []))
          .map((entry) => path.relative(pinned, path.join(entry.parentPath, entry.name)))
          .toSorted()

      const pinnedBefore = await pinnedFiles()

      const exe = await installer.compile("channels", installBody)
      expect((await installer.install(exe, "channels", install)).code).toBe(0)

      expect(await query()).toBe(before)
      expect(await pinnedFiles()).toEqual(pinnedBefore)
    } finally {
      await installer.run(["reg.exe", "delete", `HKCU\\${other}`, "/f"])
      await installer.cleanup()
    }
  },
  180_000,
)