import { NodeFileSystem } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { cleanShellFile, shellPathCommands, shellPathShared } from "../src/services/shell-config"

const repo = path.join(import.meta.dir, "../../..")
const bash = findBash()

test.skipIf(bash === undefined)(
  "the real installer writes a block the remover deletes",
  async () => {
    await using fixture = await installFixture("bash home")
    const opencodeBin = path.join(fixture.root, "opencode-bin")
    await mkdir(opencodeBin, { recursive: true })
    await writeFile(path.join(opencodeBin, "opencode"), "#!/bin/sh\nexit 0\n")
    await chmod(path.join(opencodeBin, "opencode"), 0o755)

    const before = `export PATH=${shellHome(opencodeBin)}:$PATH\n\n# panacode\nexport PATH=/custom/bin:$PATH\n`
    await writeFile(path.join(fixture.home, ".bashrc"), before)
    install(fixture, "bash")

    const installed = await readText(path.join(fixture.home, ".bashrc"))
    const command = `export PATH="${shellHome(path.join(fixture.home, ".panacode", "bin"))}:$PATH"`
    expect(installed.startsWith(before)).toBe(true)
    expect(installed.match(/# >>> panacode >>>/g)).toHaveLength(1)
    expect(installed).toContain(`${command}\n# <<< panacode <<<`)

    const resolvedBefore = resolveShell(fixture.home)
    expect(resolvedBefore.panacode).toContain(".panacode/bin")
    expect(resolvedBefore.opencode).toContain("opencode-bin")

    expect(await clean(fixture, "bash")).toBe(true)
    expect(await readText(path.join(fixture.home, ".bashrc"))).toBe(before)
    expect(resolveShell(fixture.home)).toEqual({ panacode: "", opencode: resolvedBefore.opencode })

    expect(await clean(fixture, "bash")).toBe(false)
    expect(await readText(path.join(fixture.home, ".bashrc"))).toBe(before)
  },
  120_000,
)

test.skipIf(bash === undefined)(
  "the real installer honours ZDOTDIR and XDG_CONFIG_HOME",
  async () => {
    await using fixture = await installFixture("zsh home")
    const zdot = path.join(fixture.root, "zdot dir")
    const xdg = path.join(fixture.root, "xdg config")
    await mkdir(zdot, { recursive: true })
    await mkdir(xdg, { recursive: true })
    const file = path.join(zdot, ".zshrc")
    await writeFile(file, "# user zshrc\n")

    install(fixture, "zsh", { ZDOTDIR: shellHome(zdot), XDG_CONFIG_HOME: shellHome(xdg) })

    const installed = await readText(file)
    const command = `export PATH="${shellHome(path.join(fixture.home, ".panacode", "bin"))}:$PATH"`
    expect(installed).toContain(`# >>> panacode >>>\n${command}\n# <<< panacode <<<`)
    expect(await clean(fixture, "zsh", { ZDOTDIR: zdot, XDG_CONFIG_HOME: xdg })).toBe(true)
    expect(await readText(file)).toBe("# user zshrc\n")
  },
  120_000,
)

test.skipIf(bash === undefined)(
  "the real installer writes fish_add_path",
  async () => {
    await using fixture = await installFixture("fish home")
    const file = path.join(fixture.home, ".config", "fish", "config.fish")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, "# user fish\n")

    install(fixture, "fish")

    const command = `fish_add_path "${shellHome(path.join(fixture.home, ".panacode", "bin"))}"`
    expect(await readText(file)).toContain(`# >>> panacode >>>\n${command}\n# <<< panacode <<<`)
    expect(await clean(fixture, "fish")).toBe(true)
    expect(await readText(file)).toBe("# user fish\n")
  },
  120_000,
)

test.skipIf(bash === undefined)(
  "the installer supports the sh and ash config paths",
  async () => {
    for (const shell of ["sh", "ash"] as const) {
      await using fixture = await installFixture(`${shell} home`)
      const file = path.join(fixture.home, ".ashrc")
      await writeFile(file, "# user\n")

      install(fixture, shell)

      expect(await readText(file)).toContain("# >>> panacode >>>")
      expect(await clean(fixture, shell)).toBe(true)
      expect(await readText(file)).toBe("# user\n")
    }
  },
  120_000,
)

test.skipIf(bash === undefined)(
  "a rerun does not stack blocks or rewrite a legacy entry",
  async () => {
    await using fixture = await installFixture("rerun home")
    const file = path.join(fixture.home, ".bashrc")
    await writeFile(file, "# user\n")
    install(fixture, "bash")
    const once = await readText(file)
    install(fixture, "bash")
    expect(await readText(file)).toBe(once)

    const legacy = `# user\n\n# panacode\nexport PATH=${shellHome(path.join(fixture.home, ".panacode", "bin"))}:$PATH\n`
    await writeFile(file, legacy)
    install(fixture, "bash")
    expect(await readText(file)).toBe(legacy)
  },
  120_000,
)

test.skipIf(bash === undefined)(
  "an edited block is preserved instead of duplicated",
  async () => {
    await using fixture = await installFixture("edited home")
    const file = path.join(fixture.home, ".bashrc")
    const edited = `# user\n\n# >>> panacode >>>\nexport PATH=/somewhere/else:$PATH\n# <<< panacode <<<\n`
    await writeFile(file, edited)
    install(fixture, "bash")
    expect(await readText(file)).toBe(edited)
  },
  120_000,
)

test("BOM, CRLF, and a missing final newline survive a real cleanup", async () => {
  await using fixture = await installFixture("bytes home")
  const file = path.join(fixture.home, ".bashrc")
  const bin = path.join(fixture.home, ".panacode", "bin")
  const original = `\uFEFFfirst\r\n\r\n# panacode\r\nexport PATH=${shellHome(bin)}:$PATH`
  await writeFile(file, original)

  expect(await clean(fixture, "bash", {}, bin)).toBe(true)
  expect(await readText(file)).toBe("\uFEFFfirst\r\n")
}, 60_000)

test("a shared bin directory keeps its PATH entry", async () => {
  await using fixture = await installFixture("shared home")
  const bin = path.join(fixture.home, ".panacode", "bin")
  await mkdir(bin, { recursive: true })
  await writeFile(path.join(bin, "panacode.exe"), "")
  const run = (current: string) =>
    Effect.runPromise(shellPathShared(bin, current).pipe(Effect.provide(NodeFileSystem.layer)))

  expect(await run("panacode.exe")).toBe(false)
  await writeFile(path.join(bin, "opencode"), "")
  expect(await run("panacode.exe")).toBe(true)
}, 30_000)

test.skipIf(process.platform === "win32")(
  "cleanup keeps the file mode and follows a symlink",
  async () => {
    await using fixture = await installFixture("mode home")
    const target = path.join(fixture.root, "dotfiles", "bashrc")
    await mkdir(path.dirname(target), { recursive: true })
    const bin = path.join(fixture.home, ".panacode", "bin")
    const original = `# user\n\n# panacode\nexport PATH=${bin}:$PATH\n`
    await writeFile(target, original)
    await chmod(target, 0o600)

    const link = path.join(fixture.home, ".bashrc")
    await symlink(target, link)
    expect(await clean(fixture, "bash", {}, bin)).toBe(true)
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    expect((await stat(target)).mode & 0o777).toBe(0o600)
    expect(await readText(target)).toBe("# user\n")
    expect((await stat(target)).mode & 0o777).toBe(0o600)
  },
  60_000,
)

function install(
  fixture: { readonly home: string; readonly binary: string; readonly root: string },
  shell: "bash" | "zsh" | "fish" | "sh" | "ash",
  extra: Record<string, string> = {},
) {
  const result = Bun.spawnSync({
    cmd: [bash!, path.join(repo, "install"), "--binary", shellHome(fixture.binary)],
    cwd: repo,
    env: {
      HOME: shellHome(fixture.home),
      SHELL: shell,
      PATH: "/usr/bin:/bin",
      XDG_CONFIG_HOME: shellHome(path.join(fixture.home, ".config")),
      SYSTEMROOT: process.env.SYSTEMROOT,
      WINDIR: process.env.WINDIR,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      ...extra,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(result.exitCode, `${result.stdout.toString()}\n${result.stderr.toString()}`).toBe(0)
}

async function clean(
  fixture: { readonly home: string },
  shell: "bash" | "zsh" | "fish" | "sh" | "ash",
  extra: Record<string, string> = {},
  bin = path.join(fixture.home, ".panacode", "bin"),
) {
  const files = shellConfigFiles(fixture.home, shell, extra)
  let wrote = false
  for (const file of files) {
    wrote =
      (await Effect.runPromise(
        cleanShellFile(file, shellPathCommands({ bin, fish: path.basename(file) === "config.fish" })).pipe(
          Effect.provide(NodeFileSystem.layer),
        ),
      )) || wrote
  }
  return wrote
}

function shellConfigFiles(home: string, shell: string, extra: Record<string, string>) {
  const zdot = extra.ZDOTDIR ?? home
  if (shell === "fish") return [path.join(home, ".config", "fish", "config.fish")]
  if (shell === "zsh") return [path.join(zdot, ".zshrc")]
  if (shell === "ash" || shell === "sh") return [path.join(home, ".ashrc")]
  return [path.join(home, ".bashrc")]
}

function resolveShell(home: string) {
  const result = Bun.spawnSync({
    cmd: [
      bash!,
      "-c",
      'source "$HOME/.bashrc"; command -v panacode 2>/dev/null || true; echo "---"; command -v opencode 2>/dev/null || true',
    ],
    env: { HOME: shellHome(home), SHELL: "bash", PATH: "/usr/bin:/bin" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [panacode = "", opencode = ""] = result.stdout.toString().trim().split("---")
  return { panacode: panacode.trim(), opencode: opencode.trim() }
}

async function installFixture(name: string) {
  const root = await mkdtemp(path.join(tmpdir(), "panacode-shell-"))
  const home = path.join(root, name)
  const binary = path.join(root, "panacode-fixture")
  await mkdir(home, { recursive: true })
  await writeFile(binary, "#!/bin/sh\nexit 0\n")
  await chmod(binary, 0o755)
  return {
    root,
    home,
    binary,
    async [Symbol.asyncDispose]() {
      await rm(root, { recursive: true, force: true })
    },
  }
}

// The installer runs under a POSIX shell, so paths passed to it must be in that shell's notation.
function shellHome(native: string) {
  if (process.platform !== "win32") return native
  const forward = native.replaceAll("\\", "/")
  return /^[A-Za-z]:\//.test(forward) ? `/${forward[0]!.toLowerCase()}${forward.slice(2)}` : forward
}

async function readText(file: string) {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(await readFile(file))
}

// Windows ships a WSL `bash` on PATH, which cannot see the fixture's Windows home. Prefer the
// Git-for-Windows bash that owns the checkout and reports a MINGW/MSYS/CYGWIN kernel.
function findBash() {
  if (process.platform !== "win32") return Bun.which("bash")
  const git = Bun.which("git")
  const candidates = [
    git ? path.resolve(path.dirname(git), "..", "bin", "bash.exe") : undefined,
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ]
  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue
    const probe = Bun.spawnSync({ cmd: [candidate, "-c", "uname -s"], stdout: "pipe", stderr: "ignore" })
    if (/MINGW|MSYS|CYGWIN/.test(probe.stdout.toString())) return candidate
  }
  return undefined
}

test("uninstall preserves a profile with legacy non-UTF-8 bytes", async () => {
  await using fixture = await installFixture("legacy bytes")
  const file = path.join(fixture.home, ".bashrc")
  const bin = path.join(fixture.home, ".panacode", "bin")
  const bytes = Buffer.concat([Buffer.from([0xff, 10]), Buffer.from(`# panacode\nexport PATH=${shellHome(bin)}:$PATH\n`)])
  await writeFile(file, bytes)
  expect(await clean(fixture, "bash", {}, bin)).toBe(false)
  expect(Buffer.from(await readFile(file))).toEqual(bytes)
})
