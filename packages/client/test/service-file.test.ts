import { expect, test } from "bun:test"
import { link, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Info } from "../src/service"
import { managedServiceTarget, publishRegistration, registrationSnapshot, removeOwned, withRegistrationLock } from "../src/service-file"

const registration = (id: string, pid: number): Info => ({
  id,
  product: "panacode",
  version: "test",
  url: "http://127.0.0.1:1/",
  pid,
  password: "secret",
  control: { path: path.join(tmpdir(), id + ".control"), token: "control-secret" },
})

// A service that is shutting down must only remove the registration it wrote. A newer service may
// register between the old owner's identity check and its unlink, and that record must survive.

test("an owner removes exactly its own registration", async () => {
  await using root = await fixtureRoot()
  const file = path.join(root.path, "service.json")
  const owner = registration("owner-a", 1001)
  await writeFile(file, JSON.stringify(owner))

  expect(await removeOwned(file, owner)).toBe(true)
  expect(await Bun.file(file).exists()).toBe(false)
  expect(await readdir(root.path)).toEqual([])
})

test("two sibling registration locks release independently after migration", async () => {
  await using root = await fixtureRoot()
  const source = path.join(root.path, "service-legacy.json")
  const target = path.join(root.path, "service.json")
  await withRegistrationLock(source, () =>
    withRegistrationLock(target, async () => {
      expect(await readdir(root.path)).toHaveLength(2)
    }),
  )
  expect(await readdir(root.path)).toEqual([])
})

test("a config write must finish before discovery and a losing publisher cannot change it", async () => {
  await using root = await fixtureRoot()
  const file = path.join(root.path, "service.json")
  const next = JSON.stringify(registration("next", process.pid))
  await expect(publishRegistration(file, next, undefined, async () => {
    expect(await Bun.file(file).exists()).toBe(false)
    throw new Error("configuration write failed")
  })).rejects.toThrow("configuration write failed")
  expect(await readdir(root.path)).toEqual([])
  await publishRegistration(file, next)
  let writes = 0
  await expect(publishRegistration(file, next, undefined, async () => ++writes)).rejects.toThrow("newer")
  expect(writes).toBe(0)
})

test("a stale owner never removes a registration written by a newer service", async () => {
  await using root = await fixtureRoot()
  const file = path.join(root.path, "service.json")
  const stale = registration("owner-a", 1001)
  const newer = registration("owner-b", 1002)
  await writeFile(file, JSON.stringify(stale))
  await writeFile(file, JSON.stringify(newer))

  expect(await removeOwned(file, stale)).toBe(false)
  expect(await Bun.file(file).json()).toMatchObject({ id: "owner-b", pid: 1002 })
  expect(await readdir(root.path)).toEqual(["service.json"])
})

test("a corrupt record remains continuously available during stale cleanup", async () => {
  await using root = await fixtureRoot()
  const file = path.join(root.path, "service.json")
  const owner = registration("owner-a", 1001)
  await writeFile(file, "{")

  expect(await removeOwned(file, owner)).toBe(false)
  expect(await readFile(file, "utf8")).toBe("{")
  expect(await readdir(root.path)).toEqual(["service.json"])
})

test("a missing registration is a no-op", async () => {
  await using root = await fixtureRoot()
  expect(await removeOwned(path.join(root.path, "service.json"), registration("owner-a", 1001))).toBe(false)
  expect(await readdir(root.path)).toEqual([])
})

test("old cleanup queued behind a publisher never removes the live generation or handoff", async () => {
  await using root = await fixtureRoot()
  const file = path.join(root.path, "service.json")
  const ticket = file + ".pty-handoff"
  const old = registration("owner-a", 1001)
  const next = registration("owner-b", 1002)
  await publishRegistration(file, JSON.stringify(old))
  await writeFile(ticket, "new terminal ticket")
  const published = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const change = withRegistrationLock(file, async () => {
    await writeFile(file, JSON.stringify(next))
    published.resolve()
    await release.promise
  })
  await published.promise
  const cleanup = removeOwned(file, old)
  for (let i = 0; i < 20; i++) expect(JSON.parse(await readFile(file, "utf8")).id).toBe(next.id)
  release.resolve()
  await change
  expect(await cleanup).toBe(false)
  expect(JSON.parse(await readFile(file, "utf8")).id).toBe(next.id)
  expect(await readFile(ticket, "utf8")).toBe("new terminal ticket")
})

test("a stale restart selection never clears the new terminal ticket or contacts the new owner", async () => {
  await using root = await fixtureRoot()
  const file = path.join(root.path, "service.json")
  const old = registration("old", 1001),
    next = registration("new", 1002)
  await publishRegistration(file, JSON.stringify(next))
  await writeFile(file + ".pty-handoff", "next ticket")
  const { stop } = await import("../src/promise/service")
  await stop({ file, expected: old, pty: "handoff" })
  expect(JSON.parse(await readFile(file, "utf8")).id).toBe(next.id)
  expect(await readFile(file + ".pty-handoff", "utf8")).toBe("next ticket")
})

test("a directly started contender never overwrites a newer or live registration", async () => {
  await using root = await fixtureRoot()
  const file = path.join(root.path, "service.json")
  const old = registration("old", 2_147_483_647),
    live = registration("live", process.pid)
  await writeFile(file, JSON.stringify(old))
  const previous = await registrationSnapshot(file)
  await writeFile(file, JSON.stringify(live))
  const next = JSON.stringify(registration("candidate", process.pid + 1))
  await expect(publishRegistration(file, next, previous)).rejects.toThrow("newer")
  await expect(publishRegistration(file, next, await registrationSnapshot(file))).rejects.toThrow(
    "may still have an owner",
  )
  expect(await readFile(file, "utf8")).toBe(JSON.stringify(live))
  expect(await readdir(root.path)).toEqual(["service.json"])
})

test("a foreign registration remains in place, while a captured dead Panacode generation can recover", async () => {
  await using root = await fixtureRoot()
  const file = path.join(root.path, "service.json")
  const old = registration("old", 2_147_483_647)
  const next = JSON.stringify(registration("next", process.pid))
  await writeFile(file, JSON.stringify({ ...old, product: "opencode" }))
  await expect(publishRegistration(file, next, await registrationSnapshot(file))).rejects.toThrow(
    "may still have an owner",
  )
  expect(JSON.parse(await readFile(file, "utf8")).product).toBe("opencode")
  await writeFile(file, JSON.stringify(old))
  await publishRegistration(file, next, await registrationSnapshot(file))
  expect(await readFile(file, "utf8")).toBe(next)
  const archived = (await readdir(root.path)).filter((name) => name.endsWith(".stale"))
  expect(archived).toHaveLength(1)
  expect(await readFile(path.join(root.path, archived[0]!), "utf8")).toBe(JSON.stringify(old))
})

test("linked state files and handoff sidecars are rejected before reading or publication", async () => {
  await using root = await fixtureRoot()
  const file = path.join(root.path, "service.json")
  const foreign = path.join(root.path, "foreign")
  const original = JSON.stringify(registration("foreign", 1001))
  await writeFile(foreign, original)
  await link(foreign, file)
  await expect(registrationSnapshot(file)).rejects.toThrow("Unsafe")
  await expect(publishRegistration(file, JSON.stringify(registration("candidate", process.pid)))).rejects.toThrow(
    "Unsafe",
  )
  await rm(file)
  await link(foreign, file + ".pty-handoff")
  const { environment } = await import("../src/pty-handoff")
  await expect(environment(file)).rejects.toThrow("Unsafe")
  expect(await readFile(foreign, "utf8")).toBe(original)
})

test("managed profile preserves a live unverified registration and ignores a dead r10 sibling", async () => {
  await using root = await fixtureRoot()
  using listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("witness") })
  const file = path.join(root.path, "service.json")
  const sibling = path.join(root.path, "service-prod.json")
  const r10 = { id: "historical", pid: process.pid, url: listener.url.href, password: "historical-secret" }
  for (const [name, record] of [[file, { ...r10, product: "panacode" }], [sibling, r10]] as const) {
    const bytes = JSON.stringify(record)
    await writeFile(name, bytes)
    const target = await managedServiceTarget(file)
    expect(target.file).not.toBe(file)
    expect(target.env?.XDG_STATE_HOME).toBe(path.dirname(path.dirname(target.file)))
    expect(target.env?.XDG_DATA_HOME).toBe(path.join(root.path, "coexist", "service", "data"))
    expect(await readFile(name, "utf8")).toBe(bytes)
    await rm(name)
  }
  await writeFile(sibling, JSON.stringify({ ...r10, pid: 2_147_483_647 }))
  expect(await managedServiceTarget(file)).toEqual({ file, env: undefined })
  expect(await fetch(listener.url).then((res) => res.text())).toBe("witness")
})

async function fixtureRoot() {
  const directory = await mkdtemp(path.join(tmpdir(), "panacode-service-file-"))
  return {
    path: directory,
    async [Symbol.asyncDispose]() {
      await rm(directory, { recursive: true, force: true })
    },
  }
}
