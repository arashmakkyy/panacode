import type { Endpoint, Info } from "@opencode/client/service"

/** Everything that must match before a speculative probe may be adopted. */
export type SidecarProbeKey = {
  readonly stateRoot: string
  readonly file: string
  readonly version?: string
  readonly local: boolean
}

export type SidecarProbeTake =
  | { readonly status: "miss" }
  | { readonly status: "adopted"; readonly endpoint: Endpoint }
  | {
      readonly status: "discarded"
      readonly reason: "key-mismatch" | "identity-changed" | "identity-unavailable"
    }

type ProbeResult = {
  readonly endpoint?: Endpoint
  readonly info?: Info
}

type Probe = {
  readonly key: SidecarProbeKey
  readonly result: Promise<ProbeResult>
}

// The main thread idles between showing the first window and evaluating the main bundle, waiting
// for the renderer's asset requests. That slot is long enough to find out whether a compatible
// background service is already running, so the renderer's first data request is not the first
// moment anyone asks. The probe only looks; a service that has to be started waits for the layers,
// which set the environment the CLI expects.
let probe: Probe | undefined

export function startSidecarProbe(input: { readonly key: SidecarProbeKey }) {
  const result = discover(input.key).then(
    (found) => found ?? {},
    () => ({}),
  )

  probe = { key: input.key, result }

  return result.then(() => undefined)
}

/**
 * The probe's result, once, and only when the final setup still names the same registration. A
 * service that restarted, or an environment that moved the file after boot, must go through
 * `ensure` instead of handing the renderer an endpoint the desktop no longer expects.
 */
export async function takeSidecarProbe(key: SidecarProbeKey): Promise<SidecarProbeTake> {
  const current = probe
  probe = undefined

  if (!current) return { status: "miss" }

  if (!sameKey(current.key, key)) return { status: "discarded", reason: "key-mismatch" }

  const result = await current.result

  if (result.endpoint === undefined) return { status: "miss" }

  if (result.info === undefined) return { status: "discarded", reason: "identity-unavailable" }

  const { currentOwner } = await import("@opencode/client/service")
  if (!(await currentOwner(key.file, result.info).catch(() => false)))
    return { status: "discarded", reason: "identity-changed" }

  return { status: "adopted", endpoint: result.endpoint }
}

async function discover(key: SidecarProbeKey) {
  const { Service } = await import("@opencode/client/service")

  return Service.discoverInstance({ file: key.file, version: key.version })
}

function sameKey(left: SidecarProbeKey, right: SidecarProbeKey) {
  return (
    left.stateRoot === right.stateRoot &&
    left.file === right.file &&
    left.version === right.version &&
    left.local === right.local
  )
}
