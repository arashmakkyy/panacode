import path from "node:path"

/**
 * The XDG state root every Panacode process must agree on.
 *
 * Precedence is explicit: an isolated development root, the absolute `XDG_STATE_HOME` the desktop
 * inherited, an absolute value from the login shell, then the conventional `~/.local/state`. The
 * XDG base directory specification makes relative values invalid, so they never win. Ignoring a
 * relative value in one process while another honored it would make the parent and child look for
 * the registration in different directories.
 */
export function resolveStateRoot(input: {
  readonly home: string
  readonly inherited?: string
  readonly shell?: string
  readonly isolatedRoot?: string
}) {
  for (const candidate of [input.isolatedRoot, input.inherited, input.shell]) {
    if (candidate !== undefined && path.isAbsolute(candidate)) return candidate
  }

  return path.join(input.home, ".local", "state")
}