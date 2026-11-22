import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { databasePath } from "../src/database-path"

const module = pathToFileURL(path.join(import.meta.dir, "../src/database-path.ts")).href

const saved = {
  database: process.env.PANACODE_DB,
  disableChannel: process.env.PANACODE_DISABLE_CHANNEL_DB,
}

afterEach(() => {
  restore("PANACODE_DB", saved.database)
  restore("PANACODE_DISABLE_CHANNEL_DB", saved.disableChannel)
})

// A database path is only useful if the real driver can open it and run a query. These cases keep
// the existing :memory:, default-name, channel-name and override contract while proving the guard
// does not reject ordinary private paths.
describe("database path resolution", () => {
  const cases = [
    { name: ":memory:", configured: ":memory:", disableChannel: undefined, expected: () => ":memory:" },
    {
      name: "default database",
      configured: undefined,
      disableChannel: "1",
      expected: (root: string) => path.join(root, "data", "panacode.db"),
    },
    {
      name: "channel database",
      configured: undefined,
      disableChannel: undefined,
      expected: (root: string) => path.join(root, "data", "panacode-local.db"),
    },
    {
      name: "relative override",
      configured: path.join("private", "custom.db"),
      disableChannel: undefined,
      expected: (root: string) => path.join(root, "data", "private", "custom.db"),
    },
    {
      name: "absolute private override",
      configured: "absolute",
      disableChannel: undefined,
      expected: (root: string) => path.join(root, "private", "custom.db"),
    },
  ]

  test.each(cases)("$name opens and runs a query", async (item) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-database-path-"))

    try {
      const data = path.join(root, "data")
      await fs.mkdir(data, { recursive: true })
      const configured = item.configured === "absolute" ? path.join(root, "private", "custom.db") : item.configured
      setEnvironment(configured, item.disableChannel)

      const file = databasePath(data, true)
      expect(file).toBe(item.expected(root))

      if (file !== ":memory:") await fs.mkdir(path.dirname(file), { recursive: true })
      const database = new Database(file)
      try {
        database.run("CREATE TABLE marker (value TEXT NOT NULL)")
        database.run("INSERT INTO marker VALUES (?)", [item.name])
        expect(database.query("SELECT value FROM marker").get()).toEqual({ value: item.name })

        if (file !== ":memory:") {
          expect(database.query("PRAGMA journal_mode = WAL").get()).toEqual({ journal_mode: "wal" })
          database.run("INSERT INTO marker VALUES (?)", [`${item.name} wal`])
          expect(databasePath(data)).toBe(file)
        }
      } finally {
        database.close()
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("external ownership survives an interrupted final link and rejects a replaced inode", async () => {
    const fixture = await foreignFixture()
    try {
      const data = path.join(fixture.data, "panacode")
      const external = path.join(fixture.root, "custom.db")
      setEnvironment(external, undefined)
      expect(databasePath(data, true)).toBe(external)
      const ownerDir = path.join(data, "database-owners")
      const records = await fs.readdir(ownerDir)
      expect(records).toHaveLength(1)
      const id = await fs.readFile(path.join(ownerDir, records[0]), "utf8")
      const temporary = path.join(fixture.root, `.panacode-db-${id}.tmp`)
      await fs.link(external, temporary)
      expect(databasePath(data, true)).toBe(external)
      expect(await fs.stat(external).then((info) => info.nlink)).toBe(1)
      // Retaining the original prevents the filesystem recycling its inode for this replacement.
      await fs.rename(external, external + ".previous")
      await fs.copyFile(fixture.database, external)
      expect(() => databasePath(data, true)).toThrow("ownership")
      expect(await readMarker(external)).toEqual({ value: "foreign" })
    } finally {
      await fixture.cleanup()
    }
  })

  test("ignores an inherited OPENCODE_DB", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-database-opencode-db-"))
    const previous = process.env.OPENCODE_DB

    try {
      const data = path.join(root, "data")
      await fs.mkdir(data, { recursive: true })
      process.env.OPENCODE_DB = path.join(root, "foreign", "opencode.db")
      setEnvironment(undefined, undefined)

      expect(databasePath(data)).toBe(path.join(data, "panacode-local.db"))
    } finally {
      restore("OPENCODE_DB", previous)
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

// The guard must reject every path that can make SQLite write into OpenCode's data, not just a
// literal "opencode.db" name. Each case runs in a fresh process so XDG_DATA_HOME and HOME describe
// a disposable OpenCode tree; the tree's logical contents and bytes must be untouched afterwards.
describe("database path guard", () => {
  test("rejects an explicit OpenCode database without naming the private path", async () => {
    const fixture = await foreignFixture()

    try {
      const before = await snapshot(fixture.opencode)
      const result = await probe(fixture, fixture.database)

      expect(result.ok).toBe(false)
      expect(result.message).toContain("PANACODE_DB")
      expect(result.message).not.toContain(fixture.opencode)
      expect(result.message).not.toContain(path.basename(fixture.database))
      expect(await snapshot(fixture.opencode)).toEqual(before)
      expect(await readMarker(fixture.database)).toEqual({ value: "foreign" })
    } finally {
      await fixture.cleanup()
    }
  })

  test(
    "the real server refuses a foreign PANACODE_DB before writing",
    async () => {
      const fixture = await foreignFixture()
      const alias = path.join(fixture.root, "server-alias")

      try {
        await fs.symlink(fixture.opencode, alias, process.platform === "win32" ? "junction" : "dir")
        const before = await snapshot(fixture.opencode)
        const child = Bun.spawn(
          [process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), "serve", "--port", "0"],
          {
            cwd: path.join(import.meta.dir, ".."),
            env: environment(fixture, path.join(alias, "not-created.db")),
            stdout: "ignore",
            stderr: "pipe",
          },
        )
        const stderr = new Response(child.stderr).text()
        const exited = await Promise.race([child.exited, Bun.sleep(15_000).then(() => "timeout" as const)])
        if (exited === "timeout") {
          child.kill(9)
          await child.exited
        }

        const diagnostic = await stderr
        expect(exited, diagnostic).toBeTypeOf("number")
        expect(exited, diagnostic).not.toBe(0)
        expect(diagnostic).toContain("Refusing PANACODE_DB")
        expect(await snapshot(fixture.opencode)).toEqual(before)
      } finally {
        await fixture.cleanup()
      }
    },
    30_000,
  )

  test("rejects relocated OpenCode names and unclaimed existing external databases", async () => {
    const fixture = await foreignFixture()
    try {
      for (const name of ["opencode.db", "OpenCode-next.DB", "renamed.db"]) {
        const external = path.join(fixture.root, name)
        await fs.copyFile(fixture.database, external)
        expect(await probe(fixture, external)).toMatchObject({ ok: false })
        expect(await readMarker(external)).toEqual({ value: "foreign" })
      }
    } finally {
      await fixture.cleanup()
    }
  })

  test("an unrelated dangling upstream cache link does not prevent an isolated startup", async () => {
    const fixture = await foreignFixture()
    try {
      const cache = path.join(fixture.root, "xdg-cache")
      await fs.mkdir(cache, { recursive: true })
      await fs.symlink(path.join(fixture.root, "retired-cache"), path.join(cache, "opencode"), process.platform === "win32" ? "junction" : "dir")
      expect(await probe(fixture, undefined)).toMatchObject({ ok: true })
    } finally {
      await fixture.cleanup()
    }
  })

  test("rejects a missing database under a parent alias to OpenCode", async () => {
    const fixture = await foreignFixture()
    const alias = path.join(fixture.root, "alias")

    try {
      await fs.symlink(fixture.opencode, alias, process.platform === "win32" ? "junction" : "dir")
      const before = await snapshot(fixture.opencode)
      const result = await probe(fixture, path.join(alias, "not-created.db"))

      expect(result.ok).toBe(false)
      expect(result.message).toContain("PANACODE_DB")
      expect(await snapshot(fixture.opencode)).toEqual(before)
      await expect(fs.stat(path.join(alias, "not-created.db"))).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await fixture.cleanup()
    }
  })

  test("rejects a target alias to OpenCode", async () => {
    const fixture = await foreignFixture()
    const alias = path.join(fixture.root, "target")

    try {
      await fs.symlink(fixture.opencode, alias, process.platform === "win32" ? "junction" : "dir")
      const before = await snapshot(fixture.opencode)
      const result = await probe(fixture, alias)

      expect(result.ok).toBe(false)
      expect(await snapshot(fixture.opencode)).toEqual(before)
    } finally {
      await fixture.cleanup()
    }
  })

  test.skipIf(process.platform === "win32")("rejects a file symlink to an OpenCode database", async () => {
    const fixture = await foreignFixture()
    const alias = path.join(fixture.root, "database-link.db")

    try {
      await fs.symlink(fixture.database, alias, "file")
      const before = await snapshot(fixture.opencode)
      const result = await probe(fixture, alias)

      expect(result.ok).toBe(false)
      expect(await snapshot(fixture.opencode)).toEqual(before)
    } finally {
      await fixture.cleanup()
    }
  })

  test("rejects a broken link instead of treating it as a missing file", async () => {
    const fixture = await foreignFixture()
    const broken = path.join(fixture.root, "broken")

    try {
      await fs.symlink(path.join(fixture.root, "does-not-exist"), broken, process.platform === "win32" ? "junction" : "dir")
      const result = await probe(fixture, broken)

      expect(result.ok).toBe(false)
      expect(result.message).toContain("PANACODE_DB")
      await expect(fs.stat(path.join(fixture.root, "does-not-exist"))).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await fixture.cleanup()
    }
  })

  test("rejects the default database when Panacode's data directory aliases OpenCode", async () => {
    const fixture = await foreignFixture()

    try {
      const data = path.join(fixture.root, "xdg-data", "panacode")
      await fs.symlink(fixture.opencode, data, process.platform === "win32" ? "junction" : "dir")
      const before = await snapshot(fixture.opencode)
      const result = await probe(fixture, undefined)

      expect(result.ok).toBe(false)
      expect(await snapshot(fixture.opencode)).toEqual(before)
    } finally {
      await fixture.cleanup()
    }
  })

  test.each(["-wal", "-shm", "-journal"])("rejects an aliased %s sidecar", async (suffix) => {
    const fixture = await foreignFixture()
    const database = path.join(fixture.root, "private", "panacode.db")
    const sidecar = `${database}${suffix}`

    try {
      await fs.mkdir(path.dirname(database), { recursive: true })
      await fs.symlink(fixture.opencode, sidecar, process.platform === "win32" ? "junction" : "dir")
      const before = await snapshot(fixture.opencode)
      const result = await probe(fixture, database)

      expect(result.ok).toBe(false)
      expect(await snapshot(fixture.opencode)).toEqual(before)
    } finally {
      await fixture.cleanup()
    }
  })

  test("rejects a hard link to a foreign database when the filesystem supports hard links", async () => {
    const fixture = await foreignFixture()
    const linked = path.join(fixture.root, "private", "panacode.db")

    try {
      await fs.mkdir(path.dirname(linked), { recursive: true })
      await fs.link(fixture.database, linked)

      const before = await snapshot(fixture.opencode)
      const result = await probe(fixture, linked)

      expect(result.ok).toBe(false)
      expect(result.message).toContain("PANACODE_DB")
      expect(await snapshot(fixture.opencode)).toEqual(before)
    } finally {
      await fixture.cleanup()
    }
  })

  test("rejects a legal-looking ..notes child inside OpenCode without rejecting a sibling", async () => {
    const fixture = await foreignFixture()

    try {
      const nested = path.join(fixture.opencode, "..notes")
      await fs.mkdir(nested, { recursive: true })
      const before = await snapshot(fixture.opencode)
      const inside = await probe(fixture, path.join(nested, "panacode.db"))

      expect(inside.ok).toBe(false)
      expect(await snapshot(fixture.opencode)).toEqual(before)

      const sibling = path.join(fixture.root, "xdg-data", "opencode-backup", "panacode.db")
      await fs.mkdir(path.dirname(sibling), { recursive: true })
      const allowed = await probe(fixture, sibling)

      expect(allowed).toEqual({ ok: true, result: sibling })
    } finally {
      await fixture.cleanup()
    }
  })

  test.skipIf(process.platform !== "win32")("treats Windows case aliases as the same private root", async () => {
    const fixture = await foreignFixture()

    try {
      const upper = path.join(fixture.root, "XDG-DATA", "OPENCODE", "opencode.db")
      const result = await probe(fixture, upper)
      const slashed = await probe(fixture, fixture.database.replaceAll("\\", "/"))

      expect(result.ok).toBe(false)
      expect(slashed.ok).toBe(false)
    } finally {
      await fixture.cleanup()
    }
  })

  test.skipIf(process.platform !== "win32")("accepts an absolute Windows database path outside protected roots", async () => {
    const fixture = await foreignFixture()

    try {
      // Use an absolute drive/UNC path on the fixture's volume when there is only one local drive.
      const foreignDrive = (await alternateDrive(fixture.root)) ?? fixture.root
      const result = await probe(fixture, path.join(foreignDrive, "opencode", "panacode.db"))

      expect(result.ok).toBe(true)
    } finally {
      await fixture.cleanup()
    }
  })
})

type Fixture = {
  root: string
  data: string
  opencode: string
  database: string
  cleanup: () => Promise<void>
}

async function readMarker(database: string) {
  const sqlite = new Database(database, { readonly: true })
  try {
    return sqlite.query("SELECT value FROM marker").get()
  } finally {
    sqlite.close()
  }
}

async function foreignFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "panacode-database-guard-"))
  const data = path.join(root, "xdg-data")
  const opencode = path.join(data, "opencode")
  const database = path.join(opencode, "opencode.db")
  await fs.mkdir(opencode, { recursive: true })

  const sqlite = new Database(database)
  try {
    sqlite.run("CREATE TABLE marker (value TEXT NOT NULL)")
    sqlite.run("INSERT INTO marker VALUES ('foreign')")
  } finally {
    sqlite.close()
  }

  return {
    root,
    data,
    opencode,
    database,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  }
}

function environment(fixture: Fixture, database: string | undefined) {
  return {
    ...process.env,
    HOME: path.join(fixture.root, "home"),
    USERPROFILE: path.join(fixture.root, "home"),
    XDG_DATA_HOME: fixture.data,
    XDG_CACHE_HOME: path.join(fixture.root, "xdg-cache"),
    XDG_CONFIG_HOME: path.join(fixture.root, "xdg-config"),
    XDG_STATE_HOME: path.join(fixture.root, "xdg-state"),
    PANACODE_DB: database,
    PANACODE_DISABLE_CHANNEL_DB: undefined,
    PANACODE_TEST_DATA: path.join(fixture.data, "panacode"),
    PANACODE_TEST_MODULE: module,
    PANACODE_CONFIG_CONTENT: "{}",
    PANACODE_CLI_CONFIG_CONTENT: undefined,
    PANACODE_DISABLE_MODELS_FETCH: "true",
    PANACODE_DISABLE_FILEWATCHER: "true",
  }
}

async function probe(fixture: Fixture, database: string | undefined) {
  const script = `
    const { databasePath } = await import(process.env.PANACODE_TEST_MODULE)
    try {
      const result = databasePath(process.env.PANACODE_TEST_DATA)
      console.log(JSON.stringify({ ok: true, result }))
    } catch (error) {
      console.log(JSON.stringify({ ok: false, message: String(error?.message ?? error) }))
    }
  `
  const child = Bun.spawn([process.execPath, "-e", script], {
    cwd: path.join(import.meta.dir, ".."),
    env: environment(fixture, database),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  expect(exitCode, stderr).toBe(0)
  const line = stdout.trim().split("\n").at(-1)
  expect(line, stdout + stderr).toBeTruthy()
  return JSON.parse(line!) as { ok: boolean; result?: string; message?: string }
}

async function alternateDrive(root: string) {
  const current = path.parse(root).root.toLowerCase()
  for (const letter of ["D", "E"]) {
    const drive = `${letter}:\\`
    if (drive.toLowerCase() === current) continue
    try {
      if ((await fs.stat(drive)).isDirectory()) return drive
    } catch {
      // A missing or disconnected drive is not a candidate.
    }
  }
}

async function snapshot(root: string) {
  const entries: string[] = []

  async function walk(directory: string, prefix: string) {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const relative = path.join(prefix, entry.name)
      const absolute = path.join(directory, entry.name)
      entries.push(`${relative}${entry.isDirectory() ? "/" : ""}`)
      if (entry.isDirectory()) await walk(absolute, relative)
      else if (entry.isFile()) entries.push(`${relative}:${createHash("sha256").update(await fs.readFile(absolute)).digest("hex")}`)
    }
  }

  await walk(root, "")
  return entries
}

function setEnvironment(database: string | undefined, disableChannel: string | undefined) {
  restore("PANACODE_DB", database)
  restore("PANACODE_DISABLE_CHANNEL_DB", disableChannel)
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}