import type { PromptAttachment } from "@opencode/client/promise"

// A stored file re-admits by the URI it came from, as the TUI does, so a file:// reference keeps its
// provenance (review comment files stay recognizable) instead of turning into an inline snapshot.
export function storedFileUri(file: PromptAttachment) {
  const source = file.source

  return source?.type === "uri" ? source.uri : "uri" in file ? file.uri : `data:${file.mime};base64,${file.data}`
}
