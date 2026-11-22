/**
 * Model-facing file-write leaf. Relative paths resolve within the active
 * Location. Absolute paths inside that Location are accepted, while explicit
 * absolute external paths retain mutation capability through a separate
 * external_directory approval before edit approval.
 */
export * as WriteTool from "./write.js"

import { filePathInput } from "../file-path-input.js"
import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai/effect"
import { Effect, Schema } from "effect"
import { FileWrite } from "../../file-write.js"

export const name = "write"

export const Input = filePathInput(Schema.Struct({
  path: Schema.String.annotate({
    description: "Path to the file to write to",
  }),
  content: Schema.String.annotate({ description: "Content to write to the file" }),
}))

export const Output = Schema.String
export type Output = typeof Output.Type

/** Deferred write UX integrations remain visible at the model-facing seam. */
// TODO: Publish watcher/file-edit events after watcher integration exists.
// TODO: Add snapshots / undo after design exists.
// TODO: Add LSP notification and diagnostics after LSP runtime exists.

export const Plugin = {
  id: "opencode.tool.write",
  effect: Effect.fn("WriteTool.Plugin")(function* (ctx: Context) {
    const fileWrite = yield* FileWrite.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false, permission: "edit" },
          description:
            "Writes a file to the local filesystem, overwriting if one exists.\n\nMissing parent directories are created automatically.\n\nUse this tool to create new files or overwrite existing files. Supply the path before the content. For large files, write a small complete first version, then use edit to add one section at a time. Another write replaces the whole file.",
          input: Input,
          output: Output,
          execute: (input, context) =>
            fileWrite.write(input, context).pipe(
              Effect.map((written) => ({
                output: `${written.existed ? "Wrote" : "Created"} file successfully: ${written.resource}`,
              })),
              Effect.mapError((error) => new ToolFailure({ message: `Unable to write ${input.path}`, error })),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
