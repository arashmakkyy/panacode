import { randomUUID } from "node:crypto"
import { closeSync, lstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { privateDirectory } from "@opencode/util/private-directory"
import { privateInput } from "@opencode/util/product-path"
import path from "node:path"
import { Option, Schema } from "effect"
import electron from "electron"

import { LEGACY_SETTINGS_STORE, SETTINGS_STORE } from "./keys"

/** The file: one JSON object, each key a setting whose reader decodes its value. */
const SettingsFile = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))

const cache = new Map<string, SettingsStore>()

export type SettingsStore = ReturnType<typeof createSettingsStore>

// Main-process settings only (onboarding, default server, window list, appearance, plugin storage).
// These are read synchronously before the storage layer exists and written on user action, so a
// synchronous whole-file write is acceptable here. Renderer state goes through DesktopStorage.
//
// Resolve userData lazily, after Electron selects the private Panacode profile. Earlier Panacode
// builds used a different basename in that same directory.
export function getStore(name = SETTINGS_STORE) {
  if (!name || name === "." || name === ".." || path.basename(name) !== name)
    throw new Error("Expected a desktop settings filename")
  const cached = cache.get(name)

  if (cached) return cached
  const next = createSettingsStore(path.join(electron.app.getPath("userData"), name))
  cache.set(name, next)

  return next
}

export function createSettingsStore(file: string) {
  const directory = path.dirname(file)
  if (path.basename(file) === SETTINGS_STORE && !lstatSync(file, { throwIfNoEntry: false })) {
    const previous = path.join(directory, LEGACY_SETTINGS_STORE)
    if (privateInput(previous)) renameSync(previous, file)
  }
  let data = read(file)

  const write = (next: typeof data) => {
    privateDirectory(directory, true)
    if (lstatSync(file, { throwIfNoEntry: false }) && !privateInput(file))
      throw new Error("Refusing a shared Panacode settings file")
    const temporary = `${file}.${randomUUID()}.tmp`
    const descriptor = openSync(temporary, "wx", 0o600)
    try {
      try {
        writeFileSync(descriptor, JSON.stringify(next, null, "\t"))
      } finally {
        closeSync(descriptor)
      }
      renameSync(temporary, file)
      data = next
    } finally {
      rmSync(temporary, { force: true })
    }
  }

  return {
    path: file,
    get: (key: string): Schema.Json | undefined => data[key],
    set: (key: string, value: Schema.Json) => {
      if (value === undefined) throw new TypeError(`Use \`delete()\` to clear values: ${key}`)
      write({ ...data, [key]: value })
    },
    delete: (key: string) => {
      write(Object.fromEntries(Object.entries(data).filter(([item]) => item !== key)))
    },
  }
}

// A missing file is an empty store. One that is not a JSON object is set aside instead of blocking startup.
function read(file: string): typeof SettingsFile.Type {
  if (!privateInput(file)) return {}

  const parsed = Schema.decodeUnknownOption(SettingsFile)(readFileSync(file, "utf8"))

  if (Option.isSome(parsed)) return parsed.value
  const corrupt = `${file}.corrupt`
  renameSync(file, lstatSync(corrupt, { throwIfNoEntry: false }) ? `${corrupt}.${randomUUID()}` : corrupt)

  return {}
}
