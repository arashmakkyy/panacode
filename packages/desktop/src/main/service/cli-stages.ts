import { lstat, readdir, rmdir, unlink } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { privateDirectory } from "@opencode/util/private-directory"
import { fileDigest } from "./stage-cli"

// Only remove the known executable from a content-addressed Panacode stage.
// Legacy stages and unrelated files have no receipt for ownership.
export const cleanStages = Effect.fn("DesktopCli.cleanStages")(function* (
  binary: string,
  options?: { readonly keep?: ReadonlyArray<string> },
) {
  yield* Effect.tryPromise(async () => {
    const directory = path.dirname(binary)
    const root = privateDirectory(path.dirname(directory))
    const current = path.basename(directory)
    const name = path.basename(binary)
    if (!/^panacode-cli(?:\.exe)?$/.test(name)) return
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const match = /^(.+-(?:x64|arm64))-([0-9a-f]{64})$/.exec(entry.name)
      if (!match || entry.name === current || options?.keep?.includes(match[1]!) || !entry.isDirectory()) continue
      const stage = privateDirectory(path.join(root, entry.name))
      const files = await readdir(stage)
      if (files.length !== 1 || files[0] !== name) continue
      const file = path.join(stage, name)
      const info = await lstat(file)
      if (!info.isFile() || info.nlink !== 1 || (await fileDigest(file)) !== match[2]) continue
      await unlink(file)
      await rmdir(stage)
    }
  }).pipe(Effect.catch(() => Effect.logDebug("Could not clean a staged Panacode CLI")))
})
