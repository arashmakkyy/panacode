import { fileToolPath } from "@panacode/ui/adapters/tool-call"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import { createTwoFilesPatch } from "diff"
import { toolTurn } from "@opencode/session-ui/timeline-next"
import { useData } from "@opencode/session-ui/context"
import { applyDecisions, CodeSuggestion, type CodeSuggestionLabels } from "@panacode/ui/features/code-suggestion"
import { ToolMark } from "@panacode/ui/features/tool-call/marks"
import { suggestionFromPatch } from "@panacode/ui/adapters/code-suggestion"
import { useServerSDK } from "@/runtime/server/client"
import { useLanguage } from "@/runtime/i18n/language"

type FileChange = { file: string; patch: string; status?: string }

const decoder = new TextDecoder()
const encoder = new TextEncoder()

/** The files a finished edit/write/patch changed, as unified patches (same sources as the upstream file group). */
export function toolFileChanges(tool: SessionMessageAssistantTool): FileChange[] {
  const state = tool.state
  if (state.status !== "completed") return []
  const files = (state.metadata?.files ?? []) as unknown
  if (Array.isArray(files) && files.length)
    return files.flatMap((value) =>
      value && typeof value === "object" && typeof (value as FileChange).file === "string" && typeof (value as FileChange).patch === "string"
        ? [value as FileChange]
        : [],
    )
  const input = state.input as Record<string, unknown>
  const path = fileToolPath(input)
  if (!path) return []
  if (typeof input.oldString === "string" && typeof input.newString === "string")
    return [{ file: path, patch: createTwoFilesPatch(path, path, input.oldString, input.newString), status: "modified" }]
  if (typeof input.content === "string") return [{ file: path, patch: createTwoFilesPatch(path, path, "", input.content), status: "added" }]
  return []
}

/**
 * One changed file as an Arc Code Suggestion, built from the real patch and the file on disk. Accept keeps a hunk;
 * Reject writes the file back without it. If the file changed after the edit (or it was created by the edit),
 * per-hunk Reject is disabled and Undo turn rewinds the session to before this turn.
 */
function FileSuggestion(props: { tool: SessionMessageAssistantTool; change: FileChange; title: string; labels: Partial<CodeSuggestionLabels>; conflictText: string; newFileText: string; failedText: string }) {
  const data = useData()
  const server = useServerSDK()
  const location = () => ({ directory: data.directory })
  const read = async () => decoder.decode(await server.api.file.read({ path: props.change.file, location: location() }))
  // A plain signal, not a resource: a resource read here would suspend the whole timeline while the file loads.
  const [disk, setDisk] = createSignal<string>()
  const [loaded, setLoaded] = createSignal(false)
  const refetch = async () => {
    setDisk(await read().catch(() => undefined))
    setLoaded(true)
  }
  const mutate = (value: string) => setDisk(value)
  onMount(() => void refetch())
  const [error, setError] = createSignal<string>()
  const view = createMemo(() => {
    const current = disk()
    if (current === undefined) return undefined
    return suggestionFromPatch(props.change.patch, current)
  })
  const blocked = () => {
    const v = view()
    if (!v) return loaded() ? props.conflictText : undefined
    if (props.change.status === "added") return props.newFileText
    return v.conflict ? props.conflictText : undefined
  }
  const relative = () => {
    const root = data.directory.replace(/\/+$/, "")
    return props.change.file.startsWith(root + "/") ? props.change.file.slice(root.length + 1) : props.change.file
  }
  const name = () => relative().split("/").pop() ?? relative()
  const folder = () => {
    const parts = relative().split("/")
    return parts.length > 1 ? parts.slice(0, -1).join("/") : undefined
  }

  const write = async (nextCode: string) => {
    // Conflict check right before writing: the file must still be what this card last saw.
    const now = await read().catch(() => undefined)
    if (now === undefined || now !== disk()) {
      await refetch()
      setError(props.conflictText)
      return false
    }
    try {
      await server.api.experimental.file.write({ path: props.change.file, location: location(), payload: encoder.encode(nextCode) })
      mutate(nextCode)
      setError(undefined)
      return true
    } catch {
      setError(props.failedText)
      return false
    }
  }

  const undoTurn = async () => {
    const sessionID = data.sessionID
    const messageID = toolTurn(props.tool)
    if (!sessionID || !messageID) return
    await server.api.session.interrupt({ sessionID })
    await server.api.experimental.session.wait({ sessionID })
    await server.api.session.revert.stage({ sessionID, messageID })
  }

  // Decisions keep the code "as it was"; rejects rebuild the file from it with only the kept hunks.
  let decided: Record<string, "accepted" | "rejected"> | undefined

  return (
    <Show when={view()}>
      {(v) => (
        <CodeSuggestion
          code={v().code}
          hunks={v().hunks}
          status="ready"
          instruction={props.title}
          fileName={name()}
          filePath={folder()}
          fileMark={() => <ToolMark name="file" />}
          rejectBlocked={blocked() ?? error()}
          onUndoFile={toolTurn(props.tool) ? () => void undoTurn() : undefined}
          maxCodeHeight={360}
          foldContext={3}
          labels={props.labels}
          initialDecisions={Object.fromEntries(v().rejected.map((id) => [id, "rejected" as const]))}
          onDecision={async (hunk, decision) => {
            decided ??= Object.fromEntries(v().rejected.map((id) => [id, "rejected" as const]))
            decided = { ...decided, [hunk.id]: decision }
            if (decision === "accepted") return true
            const next = applyDecisions(v().code.split("\n"), v().hunks, decided)
            const ok = await write(next)
            if (!ok) delete decided![hunk.id]
            return ok
          }}
        />
      )}
    </Show>
  )
}

export function PanacodeCodeSuggestions(props: { tool: SessionMessageAssistantTool; title: string }) {
  const language = useLanguage()
  const t = (key: string, params?: Record<string, string | number>) => language.t(key as never, params as never) as string
  const changes = createMemo(() => toolFileChanges(props.tool))
  const labels = (): Partial<CodeSuggestionLabels> => ({
    reading: (file) => t("panacode.code.reading", { file }),
    writing: t("panacode.code.writing"),
    noChanges: t("panacode.code.noChanges"),
    toReview: (count) => t(count === 1 ? "panacode.code.toReview.one" : "panacode.code.toReview", { count }),
    applied: (count) => t(count === 1 ? "panacode.code.applied.one" : "panacode.code.applied.all"),
    rejected: t("panacode.code.rejected"),
    mixed: (accepted, rejected) => t("panacode.code.mixed", { accepted, rejected }),
    change: (index, total) => t("panacode.code.change", { index, total }),
    reject: t("panacode.code.reject"),
    accept: t("panacode.code.accept"),
    rejectAll: t("panacode.code.rejectAll"),
    acceptAll: t("panacode.code.acceptAll"),
    undoFile: t("panacode.code.undoTurn"),
    regenerate: t("panacode.code.regenerate"),
    unchanged: (count) => t("panacode.code.unchanged", { count }),
    added: (count) => t("panacode.code.added", { count }),
    stats: (added, removed) => t("panacode.code.stats", { added, removed }),
  })
  return (
    <div data-component="panacode-code-suggestions" class="pc-cs-list">
      <For each={changes()}>
        {(change) => (
          <FileSuggestion
            tool={props.tool}
            change={change}
            title={props.title}
            labels={labels()}
            conflictText={t("panacode.code.conflict")}
            newFileText={t("panacode.code.newFile")}
            failedText={t("panacode.code.writeFailed")}
          />
        )}
      </For>
    </div>
  )
}
