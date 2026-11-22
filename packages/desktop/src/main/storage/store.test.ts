import { describe, expect, test } from "bun:test"
import { existsSync, linkSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createSettingsStore } from "./store"

const dir = () => mkdtempSync(path.join(tmpdir(), "opencode-settings-"))

describe("settings store", () => {
  test("reads the tab-indented file electron-store wrote and rewrites it in the same shape", () => {
    const file = path.join(dir(), "opencode.settings")
    writeFileSync(file, JSON.stringify({ windowIds: ["a"], backgroundColor: "#121212" }, null, "\t"))
    const store = createSettingsStore(file)
    expect(store.get("windowIds")).toEqual(["a"])
    store.set("backgroundColor", "#ffffff")
    expect(readFileSync(file, "utf8")).toBe(
      JSON.stringify({ windowIds: ["a"], backgroundColor: "#ffffff" }, null, "\t"),
    )
    expect(createSettingsStore(file).get("backgroundColor")).toBe("#ffffff")
  })

  test("adopts an earlier Panacode settings file once and keeps the native file authoritative", () => {
    const root = dir()
    const file = path.join(root, "panacode.settings")
    const previous = path.join(root, "opencode.settings")
    const contents = JSON.stringify({ language: "fa", windowIds: ["a"], unknown: { keep: true } })
    writeFileSync(previous, contents)
    const store = createSettingsStore(file)
    expect(store.get("language")).toBe("fa")
    expect(readFileSync(file, "utf8")).toBe(contents)
    expect(existsSync(previous)).toBe(false)
    writeFileSync(previous, '{"language":"other"}')
    expect(createSettingsStore(file).get("language")).toBe("fa")
  })

  test("skips linked legacy settings and keeps shared destinations and scratch files untouched", () => {
    const root = dir()
    const foreign = path.join(dir(), "opencode.settings")
    const file = path.join(root, "panacode.settings")
    const contents = '{"language":"private"}'
    writeFileSync(foreign, contents)
    linkSync(foreign, path.join(root, "opencode.settings"))
    linkSync(foreign, file + ".tmp")
    const store = createSettingsStore(file)
    expect(store.get("language")).toBeUndefined()
    expect(existsSync(file)).toBe(false)
    store.set("language", "fa")
    expect(readFileSync(foreign, "utf8")).toBe(contents)
    const occupied = path.join(dir(), "panacode.settings")
    linkSync(foreign, occupied)
    const shared = createSettingsStore(occupied)
    expect(shared.get("language")).toBeUndefined()
    expect(() => shared.set("language", "fa")).toThrow()
    expect(shared.get("language")).toBeUndefined()
    expect(readFileSync(foreign, "utf8")).toBe(contents)
  })

  test("starts empty without a file, creates it on the first write, and refuses undefined", () => {
    const file = path.join(dir(), "nested", "opencode.updater")
    const store = createSettingsStore(file)
    expect(store.get("ready")).toBeUndefined()
    expect(existsSync(file)).toBe(false)
    store.set("ready", { version: "1.0.0" })
    // Like electron-store, undefined is refused instead of treated as a delete.
    // @ts-expect-error undefined is not a JSON value; an untyped caller still gets the TypeError.
    expect(() => store.set("ready", undefined)).toThrow(TypeError)
    expect(store.get("ready")).toEqual({ version: "1.0.0" })
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ ready: { version: "1.0.0" } })
    store.delete("ready")
    expect(store.get("ready")).toBeUndefined()
    expect(readFileSync(file, "utf8")).toBe("{}")
  })

  test("sets an unreadable file aside instead of failing", () => {
    const file = path.join(dir(), "opencode.settings")
    writeFileSync(file, "{ not json")
    const store = createSettingsStore(file)
    expect(store.get("anything")).toBeUndefined()
    expect(existsSync(`${file}.corrupt`)).toBe(true)
    store.set("firstLaunchOnboardingComplete", true)
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ firstLaunchOnboardingComplete: true })
  })
})
