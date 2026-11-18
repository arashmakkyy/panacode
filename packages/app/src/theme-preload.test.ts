import { beforeEach, describe, expect, test } from "bun:test"

const src = await Bun.file(new URL("../public/oc-theme-preload.js", import.meta.url)).text()

const run = () => Function(src)()

const setSystemDark = (matches: boolean) =>
  Object.defineProperty(window, "matchMedia", {
    value: () => ({ matches }) as MediaQueryList,
    configurable: true,
  })

beforeEach(() => {
  document.head.innerHTML = ""
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-color-scheme")
  document.documentElement.removeAttribute("data-brand")
  document.documentElement.style.removeProperty("background-color")
  document.documentElement.style.removeProperty("color-scheme")
  localStorage.clear()
  setSystemDark(false)
})

describe("theme preload", () => {
  test.each([
    { stored: undefined, systemDark: false, scheme: "light", background: "#fafafa", ink: "#171717" },
    { stored: "dark", systemDark: false, scheme: "dark", background: "#080808", ink: "#ededed" },
    { stored: "light", systemDark: true, scheme: "light", background: "#fafafa", ink: "#171717" },
    { stored: "system", systemDark: true, scheme: "dark", background: "#080808", ink: "#ededed" },
  ])(
    "paints the default theme in $scheme for stored scheme $stored (system dark: $systemDark)",
    ({ stored, systemDark, scheme, background, ink }) => {
      setSystemDark(systemDark)

      if (stored) localStorage.setItem("opencode-color-scheme", stored)
      run()

      expect(document.documentElement.dataset.theme).toBe("panacode")
      expect(document.documentElement.dataset.brand).toBe("panacode")
      expect(document.documentElement.dataset.colorScheme).toBe(scheme)
      expect(document.documentElement.style.backgroundColor).toBe(background)
      expect(document.getElementById("oc-theme-preload-seed")?.textContent).toContain(`--text-strong:${ink}`)
    },
  )

  test.each([
    { scheme: undefined, key: "opencode-theme-css-light", css: "--background-base:#fff;", expected: "light" },
    { scheme: "dark", key: "opencode-theme-css-dark", css: "--background-base:#010203;", expected: "dark" },
  ])("restores the cached $expected css of a custom theme", ({ scheme, key, css, expected }) => {
    localStorage.setItem("opencode-theme-id", "nightowl")

    if (scheme) localStorage.setItem("opencode-color-scheme", scheme)
    localStorage.setItem(key, css)
    run()

    expect(document.documentElement.dataset.theme).toBe("nightowl")
    expect(document.documentElement.dataset.colorScheme).toBe(expected)
    expect(document.getElementById("oc-theme-preload")?.textContent).toContain(css)
  })
})
