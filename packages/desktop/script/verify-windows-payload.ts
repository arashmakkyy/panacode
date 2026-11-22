import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { getPath7za } from "app-builder-lib/out/toolsets/7zip"
import { INSTALL_MANIFEST, writeInstallManifest } from "./utils"

const run = promisify(execFile)

// Check the actual NSIS artifact. Electron-builder's unpacked directory cannot demonstrate
// that its archive filters, compression method or final installer kept every promised byte.
export async function verifyWindowsPayload(input: {
  installer: string
  buildPin: string
  helper: string
  appId: string
  executable: string
  version: string
}) {
  if (!/^[a-f0-9]{64}$/.test(input.buildPin)) throw new Error("Invalid Windows build manifest pin")
  const dir = await mkdtemp(path.join(os.tmpdir(), "panacode-payload-check-"))
  try {
    // The bundled Windows 7za.exe supports .7z payloads but omits the NSIS reader.
    // Use the full 7-Zip installation supplied by the Windows packaging runner.
    const archiver =
      process.platform === "win32"
        ? path.join(process.env.ProgramW6432 ?? process.env.ProgramFiles!, "7-Zip", "7z.exe")
        : await getPath7za()
    const { stdout } = await run(archiver, ["i"])
    if (!/^.*\bNsis\s+nsis\s/m.test(stdout)) throw new Error("Full 7-Zip with the NSIS handler is required")
    await run(archiver, [
      "e",
      "-tNsis",
      "-y",
      "-r",
      "-bso0",
      "-o" + dir,
      input.installer,
      "panacode-payload.7z",
      "panacode-files.ps1",
      "System.dll",
    ])
    const helper = path.join(dir, "panacode-files.ps1")
    if (!(await readFile(helper)).equals(await readFile(input.helper)))
      throw new Error("Changed installer verification helper")

    const payload = path.join(dir, "payload")
    await run(archiver, ["x", "-y", "-bso0", "-o" + payload, path.join(dir, "panacode-payload.7z")])
    const manifest = await readFile(path.join(payload, INSTALL_MANIFEST))
    if (createHash("sha256").update(manifest).digest("hex") !== input.buildPin)
      throw new Error("Archived manifest differs from the NSIS build pin")

    if (process.platform === "win32") {
      // NSIS puts a native plugin named System.dll in its temp directory. Windows PowerShell
      // 5.1 must compile the verifier against the framework assembly even from that directory.
      await readFile(path.join(dir, "System.dll"))
      const powershell = path.join(process.env.SystemRoot!, "SysWOW64", "WindowsPowerShell", "v1.0", "powershell.exe")
      await run(
        powershell,
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          helper,
          "-Action",
          "Stage",
          "-Root",
          payload,
          "-Pin",
          input.buildPin,
          "-AppId",
          input.appId,
          "-Executable",
          input.executable,
        ],
        { cwd: dir },
      )
    }

    const actual = await writeInstallManifest({
      appDir: payload,
      appId: input.appId,
      version: input.version,
      executable: input.executable,
    })
    if (actual !== input.buildPin) throw new Error("Archived Windows payload differs from the build manifest")
    console.log("Verified all files and digests inside the final NSIS installer")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
