import { verifiedBinary } from "./binary.js"

export const available = true

/**
 * Resolve the persistent PTY daemon for the Node build.
 *
 * The Node launcher extracts the embedded asset into a private cache and sets both variables. The
 * compiled prelude supplies a frozen location/digest in the distribution. A development override
 * needs its explicit SHA-256 as well.
 */
export function resolveBinary(_bin?: string) {
  const packaged = (globalThis as typeof globalThis & {
    __PANACODE_PACKAGED_PTY?: { file?: string; sha256?: string }
  }).__PANACODE_PACKAGED_PTY
  return packaged ? resolve(packaged.file, packaged.sha256) : resolve(process.env.PANACODE_PTY_BIN, process.env.PANACODE_PTY_BIN_SHA256)
}

export async function resolve(override: string | undefined, expected: string | undefined) {
  if (!override)
    throw new Error(
      `No persistent PTY binary is available for ${process.platform}-${process.arch}; ` +
        "install the matching @opencode/pty package or set PANACODE_PTY_BIN to an absolute path",
    )
  return verifiedBinary(override, expected)
}