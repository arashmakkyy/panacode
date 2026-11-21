import { homedir } from "node:os"
import { join } from "node:path"
import type { DiscoverOptions, Endpoint, Info } from "./service.js"
import { defaultEnsureTiming } from "./service-timing.js"
import { matchesVersion } from "./service-version.js"

/** Keep in sync with `@opencode/util/product-identity` (`ProductIdentity.slug`). */
const productSlug = "panacode"

// Shared by the Effect and Promise clients. Keep this module free of Effect so the
// Promise client never loads the Effect runtime.

export type LocalService = {
  readonly info: Info
  readonly endpoint: Endpoint
  readonly version?: string
  readonly state: "ready" | "waiting" | "failed"
  readonly compatible: boolean
}

/**
 * What `ensure()` does with a registered service that answered: return it, keep polling while
 * it starts, replace it because its version does not meet the requirement, or fail.
 */
export function decide(service: LocalService, options: DiscoverOptions) {
  if (!matchesVersion(service.version, options))
    return { _tag: "replace", pty: service.state === "ready" ? "handoff" : "clear" } as const
  if (!service.compatible)
    return fail(
      "Background service uses an incompatible health protocol. Update this client or explicitly restart the service.",
    )
  if (service.state === "ready") return { _tag: "reuse" } as const
  if (service.state === "failed") return fail("Background service failed to start")
  return { _tag: "wait" } as const
}

function fail(message: string) {
  return { _tag: "fail" as const, error: new Error(message) }
}

/** The default registration file. */
export function fallback() {
  return join(process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state"), productSlug, "service.json")
}

/** Whether two registrations describe the same service instance. */
export function same(left: Info, right: Info) {
  return (
    left.id === right.id &&
    left.product === right.product &&
    left.version === right.version &&
    left.url === right.url &&
    left.pid === right.pid
  )
}

/**
 * The loopback endpoint for a local registration. A wildcard address is normalized only here,
 * for a registration read from Panacode's own state directory. Anything that is not loopback is
 * rejected before a credential is attached: automatic local discovery must never authenticate to
 * a remote or redirected endpoint.
 */
export function localEndpoint(info: Info) {
  let url: URL
  try {
    url = new URL(info.url)
  } catch {
    return undefined
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
  // Discovery supplies its own Basic credentials. A URL that carries credentials would either leak
  // them to the service or silently override the registration password.
  if (url.username !== "" || url.password !== "") return undefined
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (hostname === "0.0.0.0" || hostname === "::") {
    url.hostname = "127.0.0.1"
    return url.href
  }
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") return undefined
  return info.url
}

/** Ask a registered owner for its health and classify the answer. */
export async function probeResult(info: Info, timeout = defaultEnsureTiming.requestTimeout) {
  if (info.product !== undefined && info.product !== "panacode") return { service: undefined, timedOut: false }
  const origin = localEndpoint(info)
  if (origin === undefined) return { service: undefined, timedOut: false }
  const endpoint = {
    url: origin,
    auth: info.password === undefined ? undefined : { type: "basic", username: "opencode", password: info.password },
  } satisfies Endpoint
  const signal = AbortSignal.timeout(timeout)
  const result = await fetch(new URL("/api/info", origin), {
    headers: headers(endpoint),
    signal,
    redirect: "error",
  })
    .then(async (response) => ({
      response,
      body: response.status === 404 ? undefined : ((await response.json()) as unknown),
    }))
    .catch(() => undefined)
  if (result === undefined) return { service: undefined, timedOut: signal.aborted }
  const response = result.response
  // A missing health endpoint identifies protocol incompatibility, not an older
  // version. Only an unmet version requirement lets ensure replace this owner.
  if (response.status === 404)
    return {
      service: {
        info,
        endpoint,
        version: info.version,
        state: "ready",
        compatible: false,
      } satisfies LocalService,
      timedOut: false,
    }
  const serverInfo = decodeInfo(result.body)
  if (serverInfo === undefined) return { service: undefined, timedOut: false }
  if (serverInfo.pid !== info.pid) return { service: undefined, timedOut: false }
  if (serverInfo.product !== undefined && serverInfo.product !== "panacode")
    return { service: undefined, timedOut: false }
  if (info.product !== undefined && serverInfo.product !== undefined && info.product !== serverInfo.product)
    return { service: undefined, timedOut: false }
  if (info.version !== undefined && serverInfo.version !== info.version) return { service: undefined, timedOut: false }
  return {
    service: {
      info,
      endpoint,
      version: serverInfo.version,
      state: response.ok ? "ready" : response.status === 500 ? "failed" : "waiting",
      compatible: true,
    } satisfies LocalService,
    timedOut: false,
  }
}

/** Create HTTP authentication headers for a service endpoint. */
export function headers(endpoint: Endpoint) {
  if (endpoint.auth === undefined) return undefined
  return {
    authorization: "Basic " + Buffer.from(endpoint.auth.username + ":" + endpoint.auth.password).toString("base64"),
  }
}

function decodeInfo(input: unknown) {
  if (typeof input !== "object" || input === null) return
  if (!("version" in input) || typeof input.version !== "string") return
  if (!("pid" in input) || typeof input.pid !== "number" || !Number.isInteger(input.pid) || input.pid < 0) return
  if ("product" in input && input.product !== undefined && input.product !== "panacode") return
  return {
    version: input.version,
    pid: input.pid,
    product: "product" in input && input.product === "panacode" ? ("panacode" as const) : undefined,
  }
}
