import os from "os"
import path from "path"

const home = os.homedir()
export const hostFilesystem = true

export const upstreamFallbackRoots = (app: string) => home ? [".local/share", ".local/state", ".cache", ".config"].map((base) => path.join(home, base, app)) : []

// XDG base directories must be absolute. A relative value is ignored here so the CLI and Desktop
// resolve the same state directory instead of one honoring it and the other falling back.
function xdg(value: string | undefined, fallback: () => string | undefined) {
  return value !== undefined && path.isAbsolute(value) ? value : fallback()
}

const data = xdg(process.env.XDG_DATA_HOME, () => (home ? path.join(home, ".local", "share") : undefined))
const cache = xdg(process.env.XDG_CACHE_HOME, () => (home ? path.join(home, ".cache") : undefined))
const config = xdg(process.env.XDG_CONFIG_HOME, () => (home ? path.join(home, ".config") : undefined))
const state = xdg(process.env.XDG_STATE_HOME, () => (home ? path.join(home, ".local", "state") : undefined))

/** The XDG base directories that root opencode's global paths. */
export function roots(app: string) {
  return {
    data: path.join(data!, app),
    cache: path.join(cache!, app),
    config: path.join(config!, app),
    state: path.join(state!, app),
    tmp: path.join(os.tmpdir(), app),
  }
}
