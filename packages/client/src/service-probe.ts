import { homedir } from "node:os"
import { join } from "node:path"
import type { DiscoverOptions, Endpoint, Info } from "./service.js"
import { defaultEnsureTiming } from "./service-timing.js"
import { matchesVersion } from "./service-version.js"

/** Keep in sync with `@opencode/util/product-identity` (`ProductIdentity.slug`). */
const productSlug = "panacode"

// Windows accepts process ids up to the signed 32-bit range. A larger value cannot name a real
// process on any supported platform.
const maxPID = 2_147_483_647

// Shared by the Effect and Promise clients. Keep this module free of Effect so the
// Promise client never loads the Effect runtime.

export type LocalService = {
  readonly info: Info
  readonly endpoint: Endpoint
  readonly version?: string
  readonly state: "ready" | "waiting" | "failed"
  readonly compatible: boolean
  /** A definite reason this endpoint must not be reused or controlled. */
  readonly error?: string
  /** PID the endpoint reported, when it answered but its registration could not be trusted. */
  readonly answeredPid?: number
}

const protocolError =
  "Background service uses an incompatible health protocol. Update this client or explicitly restart the service."

/**
 * What `ensure()` does with a registered service that answered: return it, keep polling while
 * it starts, replace it because its version does not meet the requirement, or fail.
 */
export function decide(service: LocalService, options: DiscoverOptions) {
  // Ownership and payload validity come first: an incompatible or unverified endpoint must never
  // reach replacement or handoff logic.
  if (service.error !== undefined) return fail(service.error)
  if (!service.compatible) return fail(protocolError)
  if (!matchesVersion(service.version, options))
    return { _tag: "replace", pty: service.state === "ready" ? "handoff" : "clear" } as const
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
 * Validate a registration value before it is trusted. Unknown values stay untyped at this boundary;
 * every other module receives a checked `Info`.
 */
export function parseInfo(input: unknown): Info | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined
  if (!("url" in input) || typeof input.url !== "string") return undefined
  if (localEndpoint({ url: input.url }) === undefined) return undefined
  if (!("pid" in input) || typeof input.pid !== "number" || !Number.isInteger(input.pid)) return undefined
  if (input.pid <= 0 || input.pid > maxPID) return undefined
  if ("id" in input && input.id !== undefined && (typeof input.id !== "string" || input.id.length === 0)) return undefined
  if ("version" in input && input.version !== undefined && typeof input.version !== "string") return undefined
  if ("product" in input && input.product !== undefined && input.product !== "panacode") return undefined
  if (
    "password" in input &&
    input.password !== undefined &&
    (typeof input.password !== "string" || input.password.length === 0)
  )
    return undefined
  const control = "control" in input ? parseControl(input.control) : undefined
  if ("control" in input && input.control !== undefined && control === undefined) return undefined
  return {
    id: "id" in input && typeof input.id === "string" ? input.id : undefined,
    product: "product" in input && input.product === "panacode" ? ("panacode" as const) : undefined,
    version: "version" in input && typeof input.version === "string" ? input.version : undefined,
    url: input.url,
    pid: input.pid,
    password: "password" in input && typeof input.password === "string" ? input.password : undefined,
    control,
  }
}

function parseControl(input: unknown): Info["control"] | undefined {
  if (typeof input !== "object" || input === null) return undefined
  if (!("path" in input) || typeof input.path !== "string" || input.path.length === 0) return undefined
  if (!("token" in input) || typeof input.token !== "string" || input.token.length === 0) return undefined
  return { path: input.path, token: input.token }
}

/** A registration file read result. `problem` means the file exists but is not a Panacode owner. */
export type Registration = {
  readonly info?: Info
  /** A validated loopback endpoint from a record that is otherwise unusable. */
  readonly url?: string
  readonly problem?: string
}

/**
 * Parse a registration file. A record without Panacode's product and instance identity is
 * deliberately not upgraded into a controllable service: it may belong to another product or
 * another user's install.
 */
export function parseRegistration(text: string): Registration {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { problem: "The local service registration is not valid JSON." }
  }
  const info = parseInfo(value)
  if (info === undefined)
    return {
      problem: "The local service registration is not a valid Panacode record.",
      url: recordOrigin(value),
    }
  if (info.product !== "panacode" || info.id === undefined || info.password === undefined)
    return {
      problem: "The local service registration does not identify a Panacode instance.",
      url: info.url,
    }
  return { info }
}

// A damaged record is never adopted, but a loopback URL it still names lets callers distinguish a
// live endpoint from a free port before a replacement publishes its own registration.
function recordOrigin(input: unknown) {
  if (typeof input !== "object" || input === null || !("url" in input) || typeof input.url !== "string")
    return undefined
  return localEndpoint({ url: input.url })
}

/**
 * The loopback endpoint for a local registration. A wildcard address is normalized only here,
 * for a registration read from Panacode's own state directory. Anything that is not loopback is
 * rejected before a credential is attached: automatic local discovery must never authenticate to
 * a remote or redirected endpoint.
 */
export function localEndpoint(info: { readonly url: string }) {
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

/** Whether a loopback port currently accepts any HTTP response, without sending a credential. */
export async function occupied(url: string, timeout = defaultEnsureTiming.requestTimeout) {
  if (localEndpoint({ url }) === undefined) return false
  return fetch(new URL("/api/info", url), {
    signal: AbortSignal.timeout(timeout),
    redirect: "manual",
  })
    .then((response) => {
      void response.body?.cancel()
      return true
    })
    .catch(() => false)
}

/** Ask a registered owner for its health and classify the answer. */
export async function probeResult(
  info: Info,
  timeout = defaultEnsureTiming.requestTimeout,
): Promise<{ readonly service: LocalService | undefined; readonly timedOut: boolean }> {
  if (info.product !== "panacode" || info.id === undefined || info.password === undefined)
    return { service: undefined, timedOut: false }
  const origin = localEndpoint(info)
  if (origin === undefined) return { service: undefined, timedOut: false }
  const endpoint = {
    url: origin,
    auth: { type: "basic", username: "opencode", password: info.password },
  } satisfies Endpoint
  const signal = AbortSignal.timeout(timeout)
  const result = await fetch(new URL("/api/info", origin), {
    headers: headers(endpoint),
    signal,
    // Inspect redirects instead of following them. A redirect to another loopback port is still a
    // different endpoint and cannot inherit this registration's identity.
    redirect: "manual",
  })
    .then(async (response) => ({
      response,
      body: response.status === 404 || response.status === 401 || response.status === 403 ? undefined : await readJSON(response),
    }))
    .catch(() => undefined)
  if (result === undefined) return { service: undefined, timedOut: signal.aborted }
  const response = result.response
  if (response.status >= 300 && response.status < 400)
    return denied(info, origin, "The registered endpoint redirected the health check; refusing to reuse or control it.")
  if (response.status === 401 || response.status === 403)
    return denied(
      info,
      origin,
      "The registered endpoint rejected the service credential. Another process may own the registered endpoint.",
    )
  // A missing health endpoint identifies protocol incompatibility, not an older version. It must
  // not become a replacement or handoff target.
  if (response.status === 404)
    return {
      service: { info, endpoint, version: info.version, state: "ready", compatible: false } satisfies LocalService,
      timedOut: false,
    }
  const serverInfo = decodeHealth(result.body)
  if (serverInfo === undefined)
    return denied(info, origin, "The registered endpoint returned an invalid health response; refusing to reuse it.")
  if (serverInfo.pid !== info.pid)
    return denied(
      info,
      origin,
      "The registered endpoint is owned by another process; refusing to reuse or control it.",
      serverInfo.pid,
    )
  if (serverInfo.instance !== info.id)
    return denied(info, origin, "The registered endpoint reports a different service instance; refusing to reuse it.")
  if (serverInfo.product !== undefined && serverInfo.product !== "panacode")
    return denied(info, origin, "The registered endpoint belongs to another product; refusing to reuse it.")
  if (info.version !== undefined && serverInfo.version !== info.version)
    return denied(info, origin, "The registered endpoint reports a different version than its registration; refusing to reuse it.")
  if (response.status !== 200 && response.status !== 500 && response.status !== 503)
    return denied(info, origin, `The registered endpoint returned an unexpected status ${response.status}.`)
  return {
    service: {
      info,
      endpoint,
      version: serverInfo.version,
      state: response.status === 200 ? "ready" : response.status === 500 ? "failed" : "waiting",
      compatible: true,
    } satisfies LocalService,
    timedOut: false,
  }
}

function denied(info: Info, origin: string, message: string, answeredPid?: number) {
  return {
    service: {
      info,
      endpoint: { url: origin },
      version: info.version,
      state: "failed",
      compatible: true,
      error: message,
      ...(answeredPid === undefined ? {} : { answeredPid }),
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

async function readJSON(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined)
}

function decodeHealth(input: unknown) {
  if (typeof input !== "object" || input === null) return
  if (!("version" in input) || typeof input.version !== "string" || input.version.length === 0) return
  if (!("instance" in input) || typeof input.instance !== "string" || input.instance.length === 0) return
  if (!("pid" in input) || typeof input.pid !== "number" || !Number.isInteger(input.pid) || input.pid < 0) return
  if ("product" in input && input.product !== undefined && input.product !== "panacode") return
  return {
    version: input.version,
    instance: input.instance,
    pid: input.pid,
    product: "product" in input && input.product === "panacode" ? ("panacode" as const) : undefined,
  }
}