import { readFileSync } from "node:fs"
import path from "node:path"
import { app } from "electron"
import { CHANNEL } from "../constants"
import { serviceRegistration } from "./cli-service-file"
import { startSidecarProbe } from "./sidecar-probe"

/** Start the packaged probe from the entry module, before the layers know the final setup. */
export function startPackagedSidecarProbe() {
  if (!app.isPackaged) return
  const version = CHANNEL === "beta" ? undefined : bundledVersion()

  if (version === "") return
  const local = process.env.PANACODE_DESKTOP_SERVER_CHANNEL === "local"

  const registration = serviceRegistration({
    join: path.join,
    home: app.getPath("home"),
    cliVersion: version ?? "",
    stateHome: process.env.XDG_STATE_HOME,
    local,
  })

  startSidecarProbe({
    key: { stateRoot: registration.stateRoot, file: registration.file, version, local },
  })
}

function bundledVersion() {
  for (const name of ["panacode-cli.version"]) {
    try {
      const value = readFileSync(path.join(process.resourcesPath, name), "utf8").trim()

      if (value) return value
    } catch {}
  }

  return ""
}