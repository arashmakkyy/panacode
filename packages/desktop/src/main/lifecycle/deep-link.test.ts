import { describe, expect, test } from "bun:test"
import { Effect, Logger } from "effect"
import { consoleReturnWindow, deepLinkRoute, logDeepLink, panacodeDeepLinks, type DeepLinkSource } from "./deep-link"

const markers = ["AUTH_MARKER", "HEADER_MARKER", "COOKIE_MARKER", "QUERY_MARKER", "FRAGMENT_MARKER", "PROMPT_MARKER"]

function capture(source: DeepLinkSource, urls: readonly string[]) {
  const entries: unknown[] = []

  const logger = Logger.map(Logger.formatStructured, (entry) => {
    entries.push(entry)
  })

  return Effect.runPromise(logDeepLink(source, urls).pipe(Effect.provide(Logger.layer([logger])))).then(() => entries)
}

describe("Deep link logging", () => {
  test.each([
    {
      name: "single instance",
      source: "open-url" as const,
      urls: [
        "panacode://console/authorized?window=WINDOW_MARKER&code=AUTH_MARKER&token=HEADER_MARKER#COOKIE_MARKER",
      ],
      routes: ["console-return"],
      count: 1,
    },
    {
      name: "second instance",
      source: "second-instance" as const,
      urls: [
        "panacode://open?project=C%3A%5CUsers%5CHOME_MARKER&prompt=PROMPT_MARKER",
        "panacode://console/authorized?window=QUERY_MARKER&code=AUTH_MARKER#FRAGMENT_MARKER",
      ],
      routes: ["open", "console-return"],
      count: 2,
    },
    {
      name: "malformed and foreign links",
      source: "open-url" as const,
      urls: ["panacode://[QUERY_MARKER", "https://example.test/?token=HEADER_MARKER"],
      routes: ["invalid", "other"],
      count: 2,
    },
  ])("$name keeps only allowlisted fields", async (row) => {
    const entries = await capture(row.source, row.urls)
    const rendered = JSON.stringify(entries)

    for (const marker of markers) expect(rendered).not.toContain(marker)

    expect(entries).toHaveLength(1)
    expect(rendered).toContain(JSON.stringify(row.routes))
    expect(rendered).toContain(`"count":${row.count}`)
    expect(rendered).toContain(`"source":"${row.source}"`)
  })

  test("the real URLs still reach the deep link handler unchanged", () => {
    const urls = [
      "panacode://console/authorized?window=window-a&code=private-code",
      "panacode://open?project=/home/private/project",
    ]

    expect(panacodeDeepLinks(["C:\\Program Files\\Panacode\\Panacode.exe", ...urls])).toEqual(urls)
    expect(deepLinkRoute(urls[0])).toBe("console-return")
    expect(deepLinkRoute(urls[1])).toBe("open")
  })
})

describe("Console return deep links", () => {
  test("reads the originating Desktop window", () => {
    expect(consoleReturnWindow("panacode://console/authorized?window=window-a")).toBe("window-a")
    expect(consoleReturnWindow("panacode://console/authorized?window=window%20b")).toBe("window b")
  })

  test("rejects unrelated, foreign and malformed links", () => {
    expect(consoleReturnWindow("panacode://console/other?window=window-a")).toBeUndefined()
    expect(consoleReturnWindow("panacode://other/authorized?window=window-a")).toBeUndefined()
    expect(consoleReturnWindow("opencode://console/authorized?window=window-a")).toBeUndefined()
    expect(consoleReturnWindow("https://console/authorized?window=window-a")).toBeUndefined()
    expect(consoleReturnWindow("not a url")).toBeUndefined()
    expect(consoleReturnWindow("panacode://console/authorized")).toBeUndefined()
  })
})