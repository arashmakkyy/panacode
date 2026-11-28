import { expect, test } from "bun:test"
import theme from "../../../../ui/src/theme/themes/panacode.json"
import { recordWindowColor, storedWindowColor } from "./background"

test.each(["dark", "light"] as const)("first launch paints Panacode %s", (tone) => {
  expect(storedWindowColor(undefined, tone)).toBe(theme[tone].overrides["background-base"])
})

test("a system tone change between launches selects the correct cached or branded color", () => {
  const light = recordWindowColor("#legacy", "#ffffff", { id: "custom", scheme: "system", mode: "light" })
  expect(storedWindowColor(light, "dark")).toBe(theme.dark.overrides["background-base"])
  const both = recordWindowColor(light, "#111111", { id: "custom", scheme: "system", mode: "dark" })
  expect(storedWindowColor(both, "light")).toBe("#ffffff")
  expect(storedWindowColor(both, "dark")).toBe("#111111")
  expect(recordWindowColor(both, "#111111", { id: "custom", scheme: "system", mode: "dark" })).toBe(both)
})

test("an explicit choice wins over the OS and a theme change drops the previous palette", () => {
  const previous = recordWindowColor(undefined, "#ffffff", { id: "old", scheme: "light", mode: "light" })
  expect(storedWindowColor(previous, "dark")).toBe("#ffffff")
  const next = recordWindowColor(previous, "#333333", { id: "new", scheme: "system", mode: "dark" })
  expect(storedWindowColor(next, "light")).toBe(theme.light.overrides["background-base"])
})

test("legacy stored colors remain available and invalid records fall back safely", () => {
  expect(storedWindowColor("#abcdef", "dark")).toBe("#abcdef")
  expect(storedWindowColor({ scheme: "corrupt" }, "dark")).toBe(theme.dark.overrides["background-base"])
})
