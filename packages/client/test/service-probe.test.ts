import { expect, test } from "bun:test"
import type { Info } from "../src/service"
import { localEndpoint, parseRegistration, probeResult } from "../src/service-probe"

function registration(url: string, input: Partial<Info> = {}): Info {
  return {
    id: "instance-a",
    product: "panacode",
    version: "2.0.0",
    url,
    pid: process.pid,
    password: "secret",
    control: { path: "unused-in-health", token: "control-secret" },
    ...input,
  }
}

function health(info: Info, input: Record<string, unknown> = {}) {
  return {
    version: info.version,
    instance: info.id,
    pid: info.pid,
    product: "panacode",
    urls: [info.url],
    paths: { tmp: "/tmp/panacode" },
    ...input,
  }
}

test("local discovery accepts loopback only and normalizes a wildcard address", () => {
  expect(localEndpoint({ url: "http://localhost:4096/" })).toBe("http://localhost:4096/")
  expect(localEndpoint({ url: "http://127.0.0.1:4096" })).toBe("http://127.0.0.1:4096")
  expect(localEndpoint({ url: "http://[::1]:4096/" })).toBe("http://[::1]:4096/")
  expect(localEndpoint({ url: "http://0.0.0.0:4096/" })).toBe("http://127.0.0.1:4096/")
  expect(localEndpoint({ url: "http://[::]:4096/" })).toBe("http://127.0.0.1:4096/")

  expect(localEndpoint({ url: "http://example.com:4096/" })).toBeUndefined()
  expect(localEndpoint({ url: "http://localhost.example.com:4096/" })).toBeUndefined()
  expect(localEndpoint({ url: "https://user:secret@127.0.0.1:4096/" })).toBeUndefined()
  expect(localEndpoint({ url: "ftp://localhost:4096/" })).toBeUndefined()
  expect(localEndpoint({ url: "not a url" })).toBeUndefined()
})

test("a registration is structurally validated before a credential is attached", () => {
  const valid = JSON.stringify(registration("http://127.0.0.1:4096/"))
  expect(parseRegistration(valid).info).toMatchObject({ id: "instance-a", product: "panacode", pid: process.pid })

  for (const text of [
    "not json",
    JSON.stringify({ ...registration("http://127.0.0.1:4096/"), pid: 0 }),
    JSON.stringify({ ...registration("http://127.0.0.1:4096/"), pid: -1 }),
    JSON.stringify({ ...registration("http://127.0.0.1:4096/"), pid: 1.5 }),
    JSON.stringify({ ...registration("http://127.0.0.1:4096/"), pid: "1" }),
    JSON.stringify({ ...registration("http://127.0.0.1:4096/"), url: "http://example.com/" }),
    JSON.stringify({ ...registration("http://127.0.0.1:4096/"), url: "https://user:secret@127.0.0.1/" }),
    JSON.stringify({ ...registration("http://127.0.0.1:4096/"), control: { path: "", token: "x" } }),
  ])
    expect(parseRegistration(text).problem).toBeString()
})

test("a managed record without product or instance identity is not upgraded into an owner", () => {
  for (const record of [
    { url: "http://127.0.0.1:4096/", pid: process.pid, version: "2.0.0", password: "secret" },
    { ...registration("http://127.0.0.1:4096/"), id: undefined },
    { ...registration("http://127.0.0.1:4096/"), product: undefined },
  ]) {
    const parsed = parseRegistration(JSON.stringify(record))
    expect(parsed.info).toBeUndefined()
    expect(parsed.problem).toBeString()
  }
})

test("health must name the registered instance, process, version, and product", async () => {
  let info = registration("http://127.0.0.1:1/")
  const server = Bun.serve({
    port: 0,
    fetch: () => Response.json(health(info)),
  })
  info = registration(server.url.href)
  try {
    const ready = await probeResult(info)
    expect(ready.service).toMatchObject({ version: "2.0.0", state: "ready", compatible: true })

    for (const wrong of [
      { instance: "instance-b" },
      { instance: undefined },
      { pid: process.pid + 1 },
      { version: "1.0.0" },
      { product: "opencode" },
    ]) {
      const isolated = Bun.serve({ port: 0, fetch: () => Response.json(health(info, wrong)) })
      try {
        const rejected = await probeResult({ ...info, url: isolated.url.href })
        expect(rejected.service?.state).toBe("failed")
        expect(rejected.service?.error).toBeString()
      } finally {
        isolated.stop(true)
      }
    }
  } finally {
    server.stop(true)
  }
})

test("authentication failures, redirects, and invalid payloads are definite failures", async () => {
  const responses: Array<[string, () => Response]> = [
    ["unauthorized", () => new Response(null, { status: 401 })],
    ["forbidden", () => new Response(null, { status: 403 })],
    ["redirect", () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1:1/" } })],
    ["invalid", () => new Response("not json", { status: 200 })],
  ]
  for (const [, reply] of responses) {
    const server = Bun.serve({ port: 0, fetch: reply })
    try {
      const result = await probeResult(registration(server.url.href))
      expect(result.service?.state).toBe("failed")
      expect(result.service?.error).toBeString()
    } finally {
      server.stop(true)
    }
  }
})

test("a missing health endpoint is incompatible and is not a ready service", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) })
  try {
    const result = await probeResult(registration(server.url.href))
    expect(result.service).toMatchObject({ state: "ready", compatible: false })
  } finally {
    server.stop(true)
  }
})

test("starting and failed health states keep the same instance identity", async () => {
  const info = registration("http://127.0.0.1:1/")
  const starting = Bun.serve({ port: 0, fetch: () => Response.json(health(info), { status: 503 }) })
  const failed = Bun.serve({ port: 0, fetch: () => Response.json(health(info), { status: 500 }) })
  try {
    expect((await probeResult({ ...info, url: starting.url.href })).service).toMatchObject({
      state: "waiting",
      compatible: true,
    })
    expect((await probeResult({ ...info, url: failed.url.href })).service).toMatchObject({
      state: "failed",
      compatible: true,
    })
  } finally {
    starting.stop(true)
    failed.stop(true)
  }
})

test("a registration for another product is ignored before any request", async () => {
  const info = { ...registration("http://127.0.0.1:1/"), product: "opencode" } as unknown as Info
  expect(await probeResult(info)).toEqual({ service: undefined, timedOut: false })
})