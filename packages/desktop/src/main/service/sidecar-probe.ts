import { readFileSync } from "node:fs"
import path from "node:path"
import { app } from "electron"
import type { Endpoint } from "@opencode/client/service"
import { CHANNEL } from "../constants"
import { cliServiceRegistrationFile } from "./cli-service-file"

// The main thread idles between showing the first window and evaluating the main bundle, waiting
// for the renderer's asset requests. That slot is long enough to find out whether a compatible
// background service is already running, so the renderer's first data request is not the first
// moment anyone asks. The probe only looks; a service that has to be started waits for the layers,
// which set the environment the CLI expects.
let probe: Promise<Endpoint | undefined> | undefined

export function startSidecarProbe() {
  if (!app.isPackaged) return
  const version = CHANNEL === "beta" ? undefined : bundledVersion()

  if (version === "") return
  const file = cliServiceRegistrationFile({
    join: path.join,
    home: app.getPath("home"),
    cliVersion: version ?? "",
  })
  probe = import("@opencode/client/service")
    .then(({ Service }) => Service.discover({ version, file }))
    .catch(() => undefined)
}

/** The probe's result, once: a later connect must not adopt a service that may have exited since boot. */
export function takeSidecarProbe() {
  const result = probe ?? Promise.resolve(undefined)
  probe = undefined

  return result
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
