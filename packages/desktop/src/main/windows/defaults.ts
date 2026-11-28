import { desktopZoomLevels } from "@opencode/app/desktop-menu"
import { nativeTheme, type BrowserWindowConstructorOptions } from "electron"
import { storedWindowColor } from "./background"
import { BACKGROUND_COLOR_KEY, ZOOM_LEVEL_KEY } from "../storage/keys"
import { getStore } from "../storage/store"

// Frame defaults shared by the early window (created on ready, before the renderer exists) and the
// full window setup in appearance.ts, so both draw the same frame.

// Match the renderer's 36px titlebar plus its former 8px content inset.
export const titlebarHeight = 44

export function tone() {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light"
}

// Use the same palette as the renderer before Electron displays the first frame.
export function storedBackgroundColor() {
  return storedWindowColor(getStore().get(BACKGROUND_COLOR_KEY), tone())
}

// The zoom level chosen in settings or with Zoom In and Zoom Out, or 100% when none was saved.
export function storedZoomLevel() {
  const stored = getStore().get(ZOOM_LEVEL_KEY)

  return desktopZoomLevels.find((level) => level === stored) ?? 1
}

export function titlebarOverlay(mode: "light" | "dark" = tone(), zoom = 1) {
  return {
    color: "#00000000",
    symbolColor: mode === "dark" ? "white" : "black",
    height: Math.max(titlebarHeight, Math.round(titlebarHeight * zoom)),
  }
}

// macOS and Windows hide the titlebar; Windows draws its window controls in an overlay sized to the zoom.
export function platformFrame(mode: "light" | "dark", zoom: number) {
  const frame: BrowserWindowConstructorOptions = {}

  if (process.platform === "darwin") {
    frame.titleBarStyle = "hidden"
    frame.trafficLightPosition = { x: 14, y: 14 }
  }

  if (process.platform === "win32") {
    frame.frame = false
    frame.titleBarStyle = "hidden"
    frame.titleBarOverlay = titlebarOverlay(mode, zoom)
  }

  return frame
}
