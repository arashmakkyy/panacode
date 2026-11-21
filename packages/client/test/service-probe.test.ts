import { expect, test } from "bun:test"
import type { Info } from "../src/service"
import { localEndpoint, probeResult } from "../src/service-probe"

test("local discovery accepts loopback only and normalizes a wildcard address", () => {
  expect(localEndpoint({ url: "http://localhost:4096/", pid: 1 })).toBe("http://localhost:4096/")
  expect(localEndpoint({ url: "http://127.0.0.1:4096", pid: 1 })).toBe("http://127.0.0.1:4096")
  expect(localEndpoint({ url: "http://[::1]:4096/", pid: 1 })).toBe("http://[::1]:4096/")
  expect(localEndpoint({ url: "http://0.0.0.0:4096/", pid: 1 })).toBe("http://127.0.0.1:4096/")
  expect(localEndpoint({ url: "http://[::]:4096/", pid: 1 })).toBe("http://127.0.0.1:4096/")

  expect(localEndpoint({ url: "http://example.com:4096/", pid: 1 })).toBeUndefined()
  expect(localEndpoint({ url: "http://localhost.example.com:4096/", pid: 1 })).toBeUndefined()
  expect(localEndpoint({ url: "https://user:secret@127.0.0.1:4096/", pid: 1 })).toBeUndefined()
  expect(localEndpoint({ url: "ftp://localhost:4096/", pid: 1 })).toBeUndefined()
  expect(localEndpoint({ url: "not a url", pid: 1 })).toBeUndefined()
})

test("a registration for another product is ignored before any request", async () => {
  const info: Info = JSON.parse('{"url":"http://127.0.0.1:1/","pid":1,"product":"opencode"}')
  expect(await probeResult(info)).toEqual({ service: undefined, timedOut: false })
})

test("a health response from another product is not adopted", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => Response.json({ version: "2.0.0", pid: process.pid, product: "opencode" }),
  })
  try {
    expect(await probeResult({ url: server.url.href, pid: process.pid, version: "2.0.0" })).toEqual({
      service: undefined,
      timedOut: false,
    })
  } finally {
    server.stop(true)
  }
})

test("a legacy registration and a Panacode registration both resolve a healthy service", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => Response.json({ version: "2.0.0", pid: process.pid, product: "panacode" }),
  })
  try {
    const legacy = await probeResult({ url: server.url.href, pid: process.pid, version: "2.0.0" })
    expect(legacy.service).toMatchObject({
      info: { url: server.url.href, pid: process.pid },
      endpoint: { url: server.url.href },
      version: "2.0.0",
      state: "ready",
      compatible: true,
    })

    const current = await probeResult({ url: server.url.href, pid: process.pid, version: "2.0.0", product: "panacode" })
    expect(current.service?.info.product).toBe("panacode")
    expect(current.service?.state).toBe("ready")
  } finally {
    server.stop(true)
  }
})