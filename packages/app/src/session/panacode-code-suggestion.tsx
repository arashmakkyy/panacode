import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { isConflictError, type SessionMessageAssistantTool } from "@opencode/client/promise"
import { Predicate } from "effect"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { createTwoFilesPatch } from "diff"
import { toolTurn } from "@opencode/session-ui/timeline-next"
import { useData } from "@opencode/session-ui/context"
import { CodeSuggestion, type CodeSuggestionLabels } from "@panacode/ui/features/code-suggestion"
import { ToolMark } from "@panacode/ui/features/tool-call/marks"
import { suggestionFromPatch } from "@panacode/ui/adapters/code-suggestion"
import { useServerSDK } from "@/runtime/server/client"
import { useLanguage } from "@/runtime/i18n/language"

type FileChange = { file: string; patch: string; status?: string }

// Keep review decisions in the window across row and tab remounts, scoped to their server.
const accepted = new WeakMap<object, Map<string, { patch: string; ids: string[] }>>()

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })

const encoder = new TextEncoder()

/** The files a finished edit/write/patch changed, as unified patches (same sources as the upstream file group). */
export function toolFileChanges(tool: SessionMessageAssistantTool): FileChange[] {
  const state = tool.state

  if (state.status !== "completed") return []
  const files = state.metadata?.files

  if (Array.isArray(files) && files.length) {
    return files.flatMap((value) => {
      if (!Predicate.isObject(value) || !Predicate.isString(value.file) || !Predicate.isString(value.patch)) return []

      return [{ file: value.file, patch: value.patch, status: Predicate.isString(value.status) ? value.status : undefined }]
    })
  }

  const input = state.input
  const path = input.filePath ?? input.path

  if (!Predicate.isString(path) || !path) return []

  if (Predicate.isString(input.oldString) && Predicate.isString(input.newString))
    return [{ file: path, patch: createTwoFilesPatch(path, path, input.oldString, input.newString), status: "modified" }]

  if (Predicate.isString(input.content)) return [{ file: path, patch: createTwoFilesPatch(path, path, "", input.content), status: "added" }]

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
  const language = useLanguage()
  const location = { directory: data.directory }
  const file = props.change.file
  const cache = accepted.get(server) ?? new Map<string, { patch: string; ids: string[] }>()
  accepted.set(server, cache)
  const key = JSON.stringify([location.directory, data.sessionID, props.tool.id, file])
  const controller = new AbortController()
  onCleanup(() => controller.abort())

  const read = async () => {
    const bytes = await server.api.file.read({ path: file, location }, { signal: controller.signal })

    try {
      return decoder.decode(bytes)
    } catch {
      throw new Error(language.t("panacode.code.encoding"))
    }
  }

  const [disk, setDisk] = createSignal<string>()
  const [failure, setFailure] = createSignal("")
  const [conflict, setConflict] = createSignal(false)
  const [undoPending, setUndoPending] = createSignal(false)
  const [undone, setUndone] = createSignal(false)

  const refetch = async () => {
    setFailure("")

    try { setDisk(await read()) }
    catch (cause) { if (!controller.signal.aborted) setFailure(cause instanceof Error ? cause.message : language.t("common.requestFailed")) }
  }

  onMount(() => void refetch())

  const view = createMemo(() => {
    const current = disk()

    if (current !== undefined) return suggestionFromPatch(props.change.patch, current)
  })

  const blocked = () => props.change.status === "added" ? props.newFileText
    : conflict() || view()?.conflict ? props.conflictText : undefined

  const root = location.directory.replaceAll("\\", "/").replace(/\/+$/, "")
  const path = file.replaceAll("\\", "/")

  const inRoot = /^[a-z]:\//i.test(path)
    ? path.toLowerCase().startsWith(root.toLowerCase() + "/")
    : path.startsWith(root + "/")

  const relative = inRoot ? path.slice(root.length + 1) : path
  const slash = relative.lastIndexOf("/")

  const initial = () => {
    const saved = cache.get(key)
    const result: Record<string, "accepted" | "rejected"> = {}

    if (saved?.patch === props.change.patch) for (const id of saved.ids) result[id] = "accepted"

    for (const id of view()?.rejected ?? []) result[id] = "rejected"

    return result
  }

  const undoTurn = async () => {
    const sessionID = data.sessionID
    const messageID = toolTurn(props.tool)

    if (!sessionID || !messageID || undoPending() || undone()) return
    setUndoPending(true)
    setFailure("")

    try {
      const options = { signal: AbortSignal.timeout(30_000) }
      await server.api.session.interrupt({ sessionID }, options)
      await server.api.experimental.session.wait({ sessionID }, options)
      await server.api.session.revert.stage({ sessionID, messageID }, options)
      setUndone(true)
    } catch (cause) {
      const message = language.t("common.requestFailed")
      setFailure(cause instanceof Error && cause.message ? message + " · " + cause.message : message)
    } finally { setUndoPending(false) }
  }

  return (
    <Show
      when={view()}
      fallback={
        <Show when={failure()}>
          <p role="alert">{failure()} <button type="button" onClick={() => void refetch()}>{language.t("common.retry")}</button></p>
          <figure class="m-0">
            <figcaption dir="auto">{relative}</figcaption>
            <pre dir="ltr" data-scrollable class="max-h-72 overflow-auto">{props.change.patch}</pre>
          </figure>
        </Show>
      }
    >
      {(v) => (
        <CodeSuggestion
          code={v().code}
          hunks={v().hunks}
          status="ready"
          instruction={props.title}
          fileName={relative.slice(slash + 1)}
          filePath={relative.slice(0, Math.max(0, slash))}
          fileMark={() => <ToolMark name="file" />}
          rejectBlocked={blocked()}
          feedback={failure()}
          undoPending={undoPending()}
          undoComplete={undone() ? language.t("panacode.code.undoComplete") : undefined}
          onUndoFile={toolTurn(props.tool) ? () => void undoTurn() : undefined}
          maxCodeHeight={360}
          foldContext={3}
          labels={props.labels}
          initialDecisions={initial()}
          onDecisions={async (_ids, decision, next) => {
            const snapshot = v()
            setFailure("")

            if (decision === "rejected") {
              try {
                const current = await read()

                if (current !== disk()) {
                  setConflict(true)

                  return false
                }

                const body = snapshot.render(next)
                await server.api.experimental.file.write({ path: file, location, expectedSha256: bytesToHex(sha256(encoder.encode(current))), payload: encoder.encode(body) }, { signal: controller.signal })
                setDisk(body)
              } catch (cause) {
                if (isConflictError(cause)) setConflict(true)
                else if (!controller.signal.aborted) setFailure(props.failedText)

                return false
              }
            }

            cache.delete(key)
            cache.set(key, { patch: props.change.patch, ids: Object.keys(next).filter((id) => next[id] === "accepted") })

            if (cache.size > 512) cache.delete(cache.keys().next().value!)

            return true
          }}
        />
      )}
    </Show>
  )
}

export function PanacodeCodeSuggestions(props: { tool: SessionMessageAssistantTool; title: string }) {
  const language = useLanguage()
  const t = language.t
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
    collapse: t("panacode.code.collapse"),
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
