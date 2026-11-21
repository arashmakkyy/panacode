import { expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Info } from "../src/service"
import { removeOwned } from "../src/service-file"

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

test("a quarantined record that is not ours is put back instead of deleted", async () => {
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

test("a replacement written while the old owner is cleaning up survives", async () => {
  await using root = await fixtureRoot()
  const stale = registration("owner-a", 1001)
  for (let attempt = 0; attempt < 20; attempt++) {
    const file = path.join(root.path, `service-${attempt}.json`)
    const newer = registration(`owner-b-${attempt}`, 1002 + attempt)
    await writeFile(file, JSON.stringify(stale))

    const removal = removeOwned(file, stale)
    // The live path disappears when removeOwned quarantines the old record. A writer that wins the
    // race after that point must keep its registration.
    for (let poll = 0; poll < 100; poll++) {
      if (!(await Bun.file(file).exists())) break
      await Bun.sleep(0)
    }
    await writeFile(file, JSON.stringify(newer))

    await removal
    expect(await Bun.file(file).json()).toMatchObject({ id: newer.id, pid: newer.pid })
    await rm(file, { force: true })
  }
  expect(await readdir(root.path)).toEqual([])
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