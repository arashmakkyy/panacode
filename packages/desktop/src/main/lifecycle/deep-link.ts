import { Effect } from "effect"

export type DeepLinkSource = "open-url" | "second-instance"

/** Routes that may reach a support log. A new route must be added here deliberately. */
export type DeepLinkRoute = "console-return" | "open" | "other" | "invalid"

export function panacodeDeepLinks(argv: readonly string[]) {
  return argv.filter((arg) => arg.startsWith("panacode://"))
}

export function deepLinkRoute(value: string): DeepLinkRoute {
  try {
    const url = new URL(value)

    if (url.protocol !== "panacode:") return "other"

    if (url.hostname === "console" && url.pathname === "/authorized") return "console-return"

    if (url.hostname === "open") return "open"

    return "other"
  } catch {
    return "invalid"
  }
}

// A link can carry a callback code, a project path, or a window id. Only the route and the count are loggable;
// the handler still receives the original URLs.
export function logDeepLink(source: DeepLinkSource, urls: readonly string[]) {
  return Effect.logInfo("deep link received", {
    event: "deep_link",
    source,
    count: urls.length,
    routes: [...new Set(urls.map(deepLinkRoute))],
  })
}

export function consoleReturnWindow(value: string) {
  try {
    const url = new URL(value)

    if (url.protocol !== "panacode:" || url.hostname !== "console" || url.pathname !== "/authorized") return
    const id = url.searchParams.get("window")

    if (!id || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) return

    return id
  } catch {
    return
  }
}