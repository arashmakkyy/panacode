export const available = true

export async function resolveBinary() {
  return process.env.PANACODE_PTY_BIN || "opencode-pty"
}
