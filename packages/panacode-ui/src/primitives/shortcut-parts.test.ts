import { describe, expect, test } from "bun:test"
import { shortcutParts } from "./shortcut-parts"

describe("shortcutParts", () => {
  test("splits a chord into keys", () => {
    expect(shortcutParts("Ctrl+Shift+L")).toEqual([["Ctrl", "Shift", "L"]])
  })
  test("keeps a plus key", () => {
    expect(shortcutParts("Ctrl++")).toEqual([["Ctrl", "+"]])
  })
  test("keeps a comma key", () => {
    expect(shortcutParts("Ctrl+,")).toEqual([["Ctrl", ","]])
  })
  test("splits several bindings", () => {
    expect(shortcutParts("Ctrl+K, Ctrl+Shift+P")).toEqual([["Ctrl", "K"], ["Ctrl", "Shift", "P"]])
  })
})
