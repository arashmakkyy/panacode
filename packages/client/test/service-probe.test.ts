import { expect, test } from "bun:test"
import type { Info } from "../src/service"
import { healthProof, testControl } from "./fixture/control"
import { homedir } from "node:os"
import { join } from "node:path"
import { fallback, localEndpoint, parseRegistration, probeResult } from "../src/service-probe"

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

test("both the private channel and the HTTP listener must prove this generation before discovery", async () => {
  let state: "ready" | "starting" | "failed" = "ready"
  let badProof = false
  const headers: (string | null)[] = []
  using listener = Bun.serve({
    port: 0,
    fetch(request) {
      headers.push(request.headers.get("authorization"))
      return healthProof(request, badProof ? "different-key" : channel.control.token, "instance-a", state)
    },
  })
  const owner = registration(listener.url.href)
  await using channel = await testControl(() => owner)
  const target = { ...owner, control: channel.control }
  for (const [reported, expected] of [
    ["starting", "waiting"],
    ["failed", "failed"],
    ["ready", "ready"],
  ] as const) {
    state = reported
    expect((await probeResult(target)).service).toMatchObject({ state: expected, version: "2.0.0" })
  }
  badProof = true
  expect((await probeResult(target)).service?.error).toBeString()
  using foreign = Bun.serve({
    port: 0,
    fetch(request) {
      headers.push(request.headers.get("authorization"))
      return new Response(null, { status: 204 })
    },
  })
  expect((await probeResult({ ...target, url: foreign.url.href })).service?.error).toBeString()
  expect(headers.length).toBe(5)
  expect(headers.every((value) => value === null)).toBe(true)
})

test("an unverifiable registration never sends a Basic credential, even to a responsive port", async () => {
  const seen: Array<string | null> = []
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      seen.push(request.headers.get("authorization"))
      return Response.json({ product: "panacode", pid: process.pid, version: "2.0.0", instance: "instance-a" })
    },
  })
  const result = await probeResult(registration(server.url.href, { control: undefined }))
  expect(result.service?.error).toBeString()
  expect(seen).toEqual([null])
})

test("an empty or relative XDG state root cannot select a registration in cwd", () => {
  const original = process.env.XDG_STATE_HOME
  try {
    for (const value of ["", "./state"]) {
      process.env.XDG_STATE_HOME = value
      expect(fallback()).toBe(join(homedir(), ".local", "state", "panacode", "service.json"))
    }
  } finally {
    if (original === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = original
  }
})

test("a registration for another product is ignored before any request", async () => {
  const info = { ...registration("http://127.0.0.1:1/"), product: "opencode" } as unknown as Info
  expect(await probeResult(info)).toEqual({ service: undefined, timedOut: false })
})
