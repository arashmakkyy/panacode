import { spawn } from "node:child_process"
import { join } from "node:path"
import { Option, Schema } from "effect"
import type { MainContext } from "@opencode/plugin/gui/main"
import { ManagedCli } from "../managed-cli"
import type { WslDistroProbe, WslInstalledDistro, WslOnlineDistro, WslRuntimeCheck } from "./contract"
import { discoverScript, installScript, parseVersion, probeScript, versionScript } from "./remote-cli"
import type { WslCliInstall } from "./remote-cli"

export type WslCommandLine = {
  stream: "stdout" | "stderr"
  text: string
}

export type WslCommandResult = {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

export type RunWslOptions = {
  signal?: AbortSignal
  /**
   * Ceiling on how long we wait for the child process to exit. When the
   * LXSS service or a specific distro wedges (e.g. Ubuntu-24.04 with a
   * pending first-run prompt), `wsl.exe` never returns and any command
   * that doesn't specify a timeout hangs the entire startup flow. Default
   * is 20s - enough for slow cold-starts, short enough to fail fast on
   * a wedge. Callers can override for longer-running jobs.
   */
  timeoutMs?: number
}

export type WslCliBuild = {
  version: string
  /** A locally built Linux binary, verified and hashed by `buildLocalWslCli`. */
  local?: {
    binary: string
    version: string
    target: string
    sha256: string
  }
}

export type WslRuntime = ReturnType<typeof createWslRuntime>

const DEFAULT_WSL_TIMEOUT_MS = 20_000

const DEFAULT_WSL_INSTALL_TIMEOUT_MS = 15 * 60_000

export function wslArgs(args: string[], distro?: string | null, user?: string | null) {
  // `--` hands the command line to the distro's default shell, which expands `$VAR` and `$(...)`
  // inside our inline scripts before `sh -lc` ever runs them. `--exec` runs the command directly.
  return [...(distro ? ["-d", distro] : []), ...(user ? ["--user", user] : []), "--exec", ...args]
}

export function wslCliInstallCommand(input: WslCliInstall) {
  return installScript(input)
}

export function summarize(value: string) {
  return value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
}

export function shellEscape(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

/** WSL commands; `t` resolves the plugin's copy for errors the user sees. */
export function createWslRuntime(t: MainContext["t"]) {
  const runWsl = (args: string[], opts: RunWslOptions = {}) => runCommand(system32("wsl.exe"), args, opts)

  const runPowerShell = (command: string, opts: RunWslOptions = {}) =>
    runCommand(
      system32("WindowsPowerShell/v1.0/powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      opts,
    )

  const runCommand = (command: string, args: string[], opts: RunWslOptions = {}) =>
    new Promise<WslCommandResult>((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        signal: opts.signal,
      })

      // Guard every wsl.exe invocation with a timeout. When the distro or
      // the LXSS service is wedged (Ubuntu first-run state, Windows update
      // pending, etc.) wsl.exe produces no output and never exits; without
      // this the whole sidecar spawn flow stalls the app forever.
      const timeoutMs = opts.timeoutMs ?? DEFAULT_WSL_TIMEOUT_MS

      const timeoutId = setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* ignore */
        }

        reject(new Error(t("error.commandTimeout", { command, args: args.join(" "), timeout: timeoutMs })))
      }, timeoutMs)

      let stdout = ""
      let stderr = ""
      const stdoutDecoder = createOutputDecoder()
      const stderrDecoder = createOutputDecoder()

      const append = (stream: WslCommandLine["stream"], chunk: string) => {
        if (!chunk) return

        if (stream === "stdout") {
          stdout += chunk

          return
        }

        stderr += chunk
      }

      child.stdout.on("data", (chunk: Buffer) => {
        append("stdout", stdoutDecoder.decode(chunk))
      })
      child.stdout.on("end", () => {
        append("stdout", stdoutDecoder.flush())
      })

      child.stderr.on("data", (chunk: Buffer) => {
        append("stderr", stderrDecoder.decode(chunk))
      })
      child.stderr.on("end", () => {
        append("stderr", stderrDecoder.flush())
      })

      child.once("error", (error) => {
        clearTimeout(timeoutId)
        reject(error)
      })
      child.once("close", (code, signal) => {
        clearTimeout(timeoutId)
        resolve({ code, signal, stdout, stderr })
      })
    })

  const runInteractiveCommand = async (
    command: string,
    args: string[],
    opts: RunWslOptions = {},
    defaultTimeoutMs: number,
  ) => {
    // The native addon is only needed for interactive installs; loading it here keeps it out of startup.
    const pty = await import("@lydell/node-pty")

    return new Promise<WslCommandResult>((resolve, reject) => {
      const child = pty.spawn(command, args, {
        name: "xterm-color",
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: process.env,
        useConpty: true,
      })

      let settled = false
      let stdout = ""

      const cleanup = () => {
        clearTimeout(timeoutId)
        abortCleanup?.()
      }

      const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs

      const timeoutId = setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* ignore */
        }

        if (settled) return
        settled = true
        cleanup()
        reject(new Error(t("error.commandTimeout", { command, args: args.join(" "), timeout: timeoutMs })))
      }, timeoutMs)

      const abortHandler = () => {
        try {
          child.kill()
        } catch {
          /* ignore */
        }

        if (settled) return
        settled = true
        cleanup()
        reject(new DOMException("Aborted", "AbortError"))
      }

      const abortCleanup = opts.signal
        ? (() => {
            opts.signal?.addEventListener("abort", abortHandler, { once: true })

            return () => opts.signal?.removeEventListener("abort", abortHandler)
          })()
        : undefined

      child.onData((data: string) => {
        stdout += data
      })
      child.onExit((event: { exitCode: number }) => {
        if (settled) return
        settled = true
        cleanup()
        resolve({ code: event.exitCode, signal: null, stdout, stderr: "" })
      })
    })
  }

  const runWslInDistro = (args: string[], distro?: string | null, opts?: RunWslOptions) =>
    runWsl(wslArgs(args, distro), opts)

  const runWslSh = (script: string, distro?: string | null, opts?: RunWslOptions) =>
    runWslInDistro(["sh", "-lc", script], distro, opts)

  const requireSuccess = (result: WslCommandResult, fallback: string) => {
    if (result.code === 0) return
    throw new Error(summarize(result.stderr || result.stdout) || fallback)
  }

  const probeCliTarget = async (distro: string, opts?: RunWslOptions) => {
    const result = await runWslSh(probeScript, distro, opts)

    const target = result.stdout
      .split(/\r?\n/g)
      .findLast((line) => line.startsWith("OPENCODE_REMOTE_TARGET="))
      ?.slice("OPENCODE_REMOTE_TARGET=".length)

    if (!target) throw new Error(`${distro} does not report a supported Linux target for the Panacode CLI`)

    return ManagedCli.requireTarget(target)
  }

  const managedSource = async (target: string, version: string, signal?: AbortSignal) => {
    const url = ManagedCli.metadataUrl(target, version)
    const response = await fetch(url, { signal, redirect: "error" })

    if (response.status === 404) throw new Error(ManagedCli.unavailable(target, version))

    if (!response.ok)
      throw new Error(`The managed Panacode CLI metadata for ${target} returned HTTP ${response.status}`)

    const metadata = Schema.decodeUnknownOption(ManagedCli.Metadata)(await response.json())

    if (Option.isNone(metadata))
      throw new Error(`The managed Panacode CLI metadata for ${target} version ${version} is invalid`)
    const artifact = ManagedCli.artifact(target, version, metadata.value)

    return { kind: "managed" as const, url: artifact.url, sha512: artifact.sha512 }
  }

  return {
    runWslSh,

    async probeRuntime(opts?: RunWslOptions): Promise<WslRuntimeCheck> {
      const version = await runWsl(["--version"], opts).catch((error) => ({
        code: 1,
        signal: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      }))

      if (version.code !== 0) {
        return {
          available: false,
          version: null,
          error: summarize(version.stderr || version.stdout) || t("error.unavailable"),
        }
      }

      return {
        available: true,
        version: firstLine(version.stdout),
        error: null,
      }
    },

    async listInstalled(opts?: RunWslOptions) {
      const result = await runWsl(["--list", "--verbose"], opts)

      if (result.code !== 0) {
        throw new Error(summarize(result.stderr || result.stdout) || t("error.listInstalled"))
      }

      return parseInstalledDistros(result.stdout)
    },

    async listOnline(opts?: RunWslOptions) {
      const result = await runWsl(["--list", "--online"], opts)

      if (result.code !== 0) {
        throw new Error(summarize(result.stderr || result.stdout) || t("error.listOnline"))
      }

      return parseOnlineDistros(result.stdout)
    },

    async installRuntimeElevated(opts?: RunWslOptions) {
      const script = [
        "$ErrorActionPreference = 'Stop'",
        "$process = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32/wsl.exe') -Verb RunAs -ArgumentList @('--install','--no-distribution') -Wait -PassThru",
        "if ($null -ne $process.ExitCode) { exit $process.ExitCode }",
      ].join("; ")

      const result = await runPowerShell(script, withTimeout(opts, DEFAULT_WSL_INSTALL_TIMEOUT_MS))
      requireSuccess(result, t("error.installWsl"))
    },

    async installDistro(distro: string, opts?: RunWslOptions) {
      const result = await runInteractiveCommand(
        system32("wsl.exe"),
        ["--install", "-d", distro, "--web-download", "--no-launch"],
        withTimeout(opts, DEFAULT_WSL_INSTALL_TIMEOUT_MS),
        DEFAULT_WSL_INSTALL_TIMEOUT_MS,
      )

      requireSuccess(result, t("error.installDistro", { distro }))
    },

    async installCli(distro: string, cli: WslCliBuild, opts?: RunWslOptions) {
      const target = cli.local?.target ?? (await probeCliTarget(distro, opts))

      const source = cli.local
        ? { kind: "local" as const, binary: cli.local.binary, sha256: cli.local.sha256 }
        : await managedSource(target, cli.version, opts?.signal)

      const result = await runInteractiveCommand(
        system32("wsl.exe"),
        wslArgs(["bash", "-lc", wslCliInstallCommand({ version: cli.version, target, source })], distro),
        withTimeout(opts, DEFAULT_WSL_INSTALL_TIMEOUT_MS),
        DEFAULT_WSL_INSTALL_TIMEOUT_MS,
      )

      requireSuccess(result, t("error.installOpencode"))
    },

    probeCliTarget,

    async probeDistro(name: string, opts?: RunWslOptions): Promise<WslDistroProbe> {
      const executable = await runWslInDistro(["/bin/true"], name, opts).catch((error) => ({
        code: 1,
        signal: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      }))

      if (executable.code !== 0) {
        return {
          name,
          canExecute: false,
          hasBash: false,
          hasCurl: false,
          error: summarize(executable.stderr || executable.stdout) || t("error.executeDistro"),
        }
      }

      const [bash, curl] = await Promise.all([
        runWslSh("command -v bash >/dev/null && printf yes || printf no", name, opts),
        runWslSh("command -v curl >/dev/null && printf yes || printf no", name, opts),
      ])

      return {
        name,
        canExecute: true,
        hasBash: bash.code === 0 && summarize(bash.stdout) === "yes",
        hasCurl: curl.code === 0 && summarize(curl.stdout) === "yes",
        error: null,
      }
    },

    async resolveCli(distro: string, version: string, opts?: RunWslOptions) {
      const target = await probeCliTarget(distro, opts)
      return firstLine((await runWslSh(discoverScript({version, target}), distro, opts)).stdout)
    },

    async readCliVersion(command: string, distro: string, opts?: RunWslOptions) {
      const result = await runWslSh(versionScript(shellEscape(command)), distro, opts)

      return parseVersion(result.stdout)
    },
  }
}

function createOutputDecoder() {
  let decoder: TextDecoder | undefined

  return {
    decode(chunk: Buffer) {
      decoder ??= new TextDecoder(detectOutputEncoding(chunk))

      return decoder.decode(chunk, { stream: true })
    },
    flush() {
      return decoder?.decode() ?? ""
    },
  }
}

function detectOutputEncoding(chunk: Uint8Array) {
  if (chunk[0] === 0xff && chunk[1] === 0xfe) return "utf-16le"
  const pairs = Math.floor(chunk.length / 2)

  if (pairs < 2) return "utf-8"
  const oddZeroes = Array.from({ length: pairs }).filter((_, index) => chunk[index * 2 + 1] === 0).length
  const evenZeroes = Array.from({ length: pairs }).filter((_, index) => chunk[index * 2] === 0).length

  return oddZeroes >= Math.ceil(pairs / 3) && evenZeroes * 2 <= oddZeroes ? "utf-16le" : "utf-8"
}

function parseInstalledDistros(output: string) {
  return output.split(/\r?\n/g).flatMap((line) => {
    const trimmed = line.trim()

    if (!trimmed) return []
    const match = line.match(/^\s*(\*)?\s*(.*?)\s{2,}\S+\s+(\d+)\s*$/)

    if (!match) return []
    const [, marker, name, version] = match

    if (!name || /^name$/i.test(name)) return []

    return [
      {
        name: name.trim(),
        version: Number.isNaN(Number.parseInt(version, 10)) ? null : Number.parseInt(version, 10),
        isDefault: marker === "*",
      } satisfies WslInstalledDistro,
    ]
  })
}

function parseOnlineDistros(output: string) {
  return output.split(/\r?\n/g).flatMap((line) => {
    const trimmed = line.trim()

    if (!trimmed) return []
    const match = trimmed.match(/^([A-Za-z0-9._-]+)\s{2,}(.+)$/)

    if (!match) return []
    const [, name, label] = match

    if (/^name$/i.test(name)) return []

    return [{ name, label: label.trim() } satisfies WslOnlineDistro]
  })
}

function firstLine(value: string) {
  return (
    value
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  )
}

export function system32(command: string) {
  return join(process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows", "System32", command)
}

function withTimeout(opts: RunWslOptions | undefined, timeoutMs: number): RunWslOptions {
  return {
    ...opts,
    timeoutMs: opts?.timeoutMs ?? timeoutMs,
  }
}
