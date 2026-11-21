import { dependencyBinary, verifiedBinary } from "./binary.js"

export const available = true

/**
 * Resolve the persistent PTY daemon for the Node build.
 *
 * The Node launcher extracts the embedded asset into a private cache and sets both variables. The
 * digest is checked when present, so a modified cache file is refused. Development and tests may
 * set only `PANACODE_PTY_BIN`; it must still be an absolute ordinary file, never a PATH name.
 */
export function resolveBinary(_bin?: string) {
  return resolve(process.env.PANACODE_PTY_BIN, process.env.PANACODE_PTY_BIN_SHA256)
}

export async function resolve(override: string | undefined, expected: string | undefined) {
  if (!override)
    throw new Error(
      `No persistent PTY binary is available for ${process.platform}-${process.arch}; ` +
        "install the matching @opencode/pty package or set PANACODE_PTY_BIN to an absolute path",
    )
  return expected ? verifiedBinary(override, expected) : dependencyBinary(override, "PANACODE_PTY_BIN")
}