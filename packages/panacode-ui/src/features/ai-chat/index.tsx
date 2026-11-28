import { ManualCopy } from "../../primitives/manual-copy"
import { writeClipboard } from "@opencode/ui/clipboard"
import { createMemo, createSignal, createUniqueId, For, onCleanup, Show, type JSX } from "solid-js"
import { Collapse } from "../../motion/presence"
import { Shimmer } from "../tool-call"
import { Button } from "../../primitives/button"
import { ChatIcon, StopGlyph } from "./icons"
import "./ai-chat.css"

/**
 * Solid port of the Arc "AI chat" reply parts (recreate-arc-ai-chat): the reasoning head (model mark,
 * "Thinking" shimmer, "Thought for Ns", the folding thought), the tool chips with their detail
 * (searches and source rows), the reply actions (copy with its icon swap, retry, versions), the stopped
 * line, the failed reply card, and the model menu.
 *
 * Panacode tweaks: the thread, bubbles and composer stay the session timeline's own (they are wired to
 * the real session); these parts render inside it from real message parts. No simulated replies, and
 * feedback thumbs are omitted because there is nowhere real to send them.
 */

export interface ChatSource {
  title: string
  url: string
  snippet?: string
  mark?: () => JSX.Element
}

export interface ChatTool {
  id: string
  name: string
  /** Label while the tool is running, e.g. "Searching the web". */
  activeName?: string
  status: "running" | "done" | "error"
  /** Short result such as "4 sources". */
  summary?: string
  icon?: "search" | "file"
  input?: string[]
  output?: string
  sources?: ChatSource[]
}

export type ChatLabels = {
  thinking: string
  thoughtFor: (seconds: number) => string
  thoughtBriefly: string
  copy: string
  copied: string
  copyFailed: string
  manualCopy: string
  close: string
  retry: string
  stopped: string
  stoppedBeforeAnswer: string
  failed: string
  searches: string
  sources: string
  result: string
  previousVersion: string
  nextVersion: string
  version: (index: number, total: number) => string
}

export const defaultChatLabels: ChatLabels = {
  thinking: "Thinking",
  thoughtFor: (seconds) => `Thought for ${seconds}s`,
  thoughtBriefly: "Thought briefly",
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Copy failed",
  manualCopy: "Select and copy the text",
  close: "Close",
  retry: "Retry",
  stopped: "Stopped",
  stoppedBeforeAnswer: "Stopped before answering",
  failed: "Reply failed.",
  searches: "Searches",
  sources: "Sources",
  result: "Result",
  previousVersion: "Previous version",
  nextVersion: "Next version",
  version: (index, total) => `Version ${index} of ${total}`,
}

const merge = (labels?: Partial<ChatLabels>) => ({ ...defaultChatLabels, ...labels })

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** Arc `Swap`: the label crossfades when its key changes. */
function Swap(props: { key: string; children: JSX.Element }) {
  return (
    <span class="pc-ac-swap">
      <Show when={props.key} keyed>
        {(_key: string) => <span class="pc-ac-swapItem pc-ac-fadeIn">{props.children}</span>}
      </Show>
    </span>
  )
}

function SourceMark(props: { source: ChatSource }) {
  return (
    <Show when={props.source.mark !== undefined} fallback={<ChatIcon name="globe" size={14} class="pc-ac-mark" />}>
      <span class="pc-ac-mark">{props.source.mark?.()}</span>
    </Show>
  )
}

/* -------------------------------------------------------------- reasoning */

export function ChatReasoning(props: {
  /** The model's mark, 16px. */
  mark?: () => JSX.Element
  modelName?: string
  thinking: boolean
  /** Whole seconds the model thought, once it is done. */
  thoughtFor?: number
  /** Whether there is a thought to open. */
  hasText: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** The thought itself (plain text or rendered markdown). */
  children?: JSX.Element
  labels?: Partial<ChatLabels>
}) {
  const labels = () => merge(props.labels)
  const id = createUniqueId()
  const [local, setLocal] = createSignal(props.defaultOpen ?? false)
  const open = () => props.open ?? local()
  const canOpen = () => props.hasText
  const label = () =>
    props.thinking
      ? labels().thinking
      : props.thoughtFor
        ? labels().thoughtFor(props.thoughtFor)
        : props.hasText
          ? labels().thoughtBriefly
          : (props.modelName ?? "")

  const toggle = () => {
    if (!canOpen()) return
    const next = !open()
    setLocal(next)
    props.onOpenChange?.(next)
  }

  return (
    <div class="pc-ac-reasoning" data-component="panacode-chat-reasoning">
      <div class="pc-ac-replyHead">
        <Show when={props.mark !== undefined}>
          <span class="pc-ac-replyMark" title={props.modelName}>
            {props.mark?.()}
          </span>
        </Show>
        <button
          type="button"
          class="pc-ac-thoughtButton"
          aria-expanded={canOpen() ? open() : undefined}
          aria-controls={open() ? id : undefined}
          disabled={!canOpen()}
          onClick={toggle}
        >
          <Swap key={props.thinking ? "thinking" : label()}>
            <Show when={props.thinking} fallback={label()}>
              <Shimmer active>{labels().thinking}</Shimmer>
            </Show>
          </Swap>
          <span
            class="pc-ac-thoughtChevron"
            data-open={open() || undefined}
            data-hidden={!canOpen() || undefined}
            style={{ display: "inline-flex" }}
          >
            <ChatIcon name="chevronRight" size={14} />
          </span>
        </button>
      </div>
      <Collapse open={open() && canOpen()} class="pc-ac-clip" id={id}>
        <div class="pc-ac-thoughtText">{props.children}</div>
      </Collapse>
    </div>
  )
}

/* ------------------------------------------------------------------ tools */

function uniqueByHost(sources: ChatSource[]) {
  const seen = new Set<string>()
  return sources.filter((source) => {
    const host = hostOf(source.url)
    if (seen.has(host)) return false
    seen.add(host)
    return true
  })
}

function ToolChip(props: { tool: ChatTool; open: boolean; onToggle: () => void; detailId: string }) {
  const running = () => props.tool.status === "running"
  const canOpen = () =>
    !running() && !!(props.tool.input?.length || props.tool.sources?.length || props.tool.output)
  return (
    <button
      type="button"
      class="pc-ac-toolChip"
      data-status={props.tool.status}
      aria-expanded={canOpen() ? props.open : undefined}
      aria-controls={props.open ? props.detailId : undefined}
      disabled={!canOpen()}
      onClick={props.onToggle}
    >
      <span class="pc-ac-toolIcon pc-ac-iconCell">
        <Show when={props.tool.status} keyed>
          {(status) => (
            <span class="pc-ac-fadeIn">
              {status === "running" ? (
                <ChatIcon name="loader" size={14} class="pc-ac-spin" />
              ) : status === "error" ? (
                <ChatIcon name="alert" size={14} />
              ) : (
                <ChatIcon name={props.tool.icon ?? "search"} size={14} />
              )}
            </span>
          )}
        </Show>
      </span>
      <Swap key={running() ? "running" : `${props.tool.status}-${props.tool.name}`}>
        <Show
          when={!running()}
          fallback={<Shimmer active>{props.tool.activeName ?? props.tool.name}</Shimmer>}
        >
          <span class="pc-ac-toolName">{props.tool.name}</span>
          <Show when={props.tool.sources?.length}>
            <span class="pc-ac-toolMarks">
              <For each={uniqueByHost(props.tool.sources ?? []).slice(0, 3)}>
                {(source) => <SourceMark source={source} />}
              </For>
            </span>
          </Show>
          <Show when={props.tool.summary}>
            <span class="pc-ac-toolSummary">{props.tool.summary}</span>
          </Show>
        </Show>
      </Swap>
    </button>
  )
}

function ToolDetail(props: { tool: ChatTool; labels: ChatLabels }) {
  return (
    <div class="pc-ac-toolDetail">
      <Show when={props.tool.input?.length}>
        <ul class="pc-ac-queries" aria-label={props.labels.searches}>
          <For each={props.tool.input}>
            {(query) => (
              <li>
                <ChatIcon name="search" size={13} />
                {query}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.tool.sources?.length}>
        <ol class="pc-ac-sourceList" aria-label={props.labels.sources}>
          <For each={props.tool.sources}>
            {(source) => (
              <li>
                <a href={source.url} target="_blank" rel="noreferrer" class="pc-ac-sourceRow">
                  <SourceMark source={source} />
                  <span class="pc-ac-sourceRowTitle">{source.title}</span>
                  <span class="pc-ac-sourceRowDomain">{hostOf(source.url)}</span>
                </a>
              </li>
            )}
          </For>
        </ol>
      </Show>
      <Show when={props.tool.output}>
        <p class="pc-ac-toolOutput">
          <span>{props.labels.result}</span>
          <span class="pc-ac-toolOutputValue">{props.tool.output}</span>
        </p>
      </Show>
    </div>
  )
}

/** Arc `Tools`: a row of chips, one detail panel for the open chip. */
export function ChatTools(props: { tools: ChatTool[]; labels?: Partial<ChatLabels> }) {
  const [openId, setOpenId] = createSignal<string | null>(null)
  const detailId = createUniqueId()
  const openTool = createMemo(() => props.tools.find((tool) => tool.id === openId() && tool.status !== "running"))
  return (
    <div class="pc-ac-tools" data-component="panacode-chat-tools">
      <div class="pc-ac-toolRow">
        <For each={props.tools}>
          {(tool) => (
            <ToolChip
              tool={tool}
              open={openId() === tool.id}
              detailId={detailId}
              onToggle={() => setOpenId(openId() === tool.id ? null : tool.id)}
            />
          )}
        </For>
      </div>
      <Collapse open={!!openTool()} class="pc-ac-clip" id={detailId}>
        <Show when={openTool()}>{(tool) => <ToolDetail tool={tool()} labels={merge(props.labels)} />}</Show>
      </Collapse>
    </div>
  )
}

/* ---------------------------------------------------------------- actions */

export function ChatAction(props: {
  label: string
  onClick: () => void
  pressed?: boolean
  disabled?: boolean
  class?: string
  children: JSX.Element
}) {
  return (
    <button
      type="button"
      class={`pc-ac-action ${props.class ?? ""}`}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  )
}

export function ChatCopyAction(props: { text: string; nativeCopy?: (text: string) => Promise<void>; label?: string; labels?: Partial<ChatLabels> }) {
  const labels = () => merge(props.labels)
  const [state, setState] = createSignal<"idle" | "copied" | "error">("idle")
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const copy = async () => {
    clearTimeout(timer)
    const copied = await writeClipboard(props.text, props.nativeCopy)
    setState(copied ? "copied" : "error")
    if (copied) timer = setTimeout(() => setState("idle"), 1400)
  }
  const label = () =>
    state() === "copied" ? labels().copied : state() === "error" ? labels().copyFailed : (props.label ?? labels().copy)
  return (
    <>
    <ChatAction label={label()} onClick={() => void copy()} class="pc-ac-copyIcon">
      <span class="pc-ac-iconCell">
        <Show when={state()} keyed>
          {(value) => (
            <span data-state={value} class="pc-ac-iconPop">
              <ChatIcon name={value === "copied" ? "check" : value === "error" ? "x" : "copy"} size={15} />
            </span>
          )}
        </Show>
      </span>
    </ChatAction>
    <span class="pc-ac-srOnly" role="status">{state() === "copied" ? labels().copied : ""}</span>
    <Show when={state() === "error"}>
      <ManualCopy label={labels().manualCopy} close={labels().close} text={props.text} onClose={() => setState("idle")} />
    </Show>
    </>
  )
}

export function ChatVersions(props: {
  index: number
  total: number
  onChange: (index: number) => void
  disabled?: boolean
  labels?: Partial<ChatLabels>
}) {
  const labels = () => merge(props.labels)
  return (
    <div class="pc-ac-versions" role="group" aria-label={labels().version(props.index + 1, props.total)}>
      <button
        type="button"
        class="pc-ac-versionButton"
        aria-label={labels().previousVersion}
        disabled={props.disabled || props.index === 0}
        onClick={() => props.onChange(props.index - 1)}
      >
        <span style={{ transform: "scaleX(-1)", display: "inline-flex" }}>
          <ChatIcon name="chevronRight" size={15} />
        </span>
      </button>
      <span class="pc-ac-versionCount" aria-hidden="true">
        {props.index + 1} / {props.total}
      </span>
      <button
        type="button"
        class="pc-ac-versionButton"
        aria-label={labels().nextVersion}
        disabled={props.disabled || props.index === props.total - 1}
        onClick={() => props.onChange(props.index + 1)}
      >
        <ChatIcon name="chevronRight" size={15} />
      </button>
    </div>
  )
}

/** Arc reply actions: copy and retry, quiet until the turn is hovered (always shown on the last turn). */
export function ChatReplyActions(props: {
  nativeCopy?: (text: string) => Promise<void>
  copyText: string
  onRetry?: () => void
  retryDisabled?: boolean
  /** Hidden while the reply is still pending. */
  hidden?: boolean
  /** Panacode: the quiet meta after the actions (model, duration, speed). */
  meta?: JSX.Element
  /** Panacode: chips before the actions (sources). */
  lead?: JSX.Element
  labels?: Partial<ChatLabels>
}) {
  const labels = () => merge(props.labels)
  return (
    <div class="pc-ac-actions" data-component="panacode-chat-actions" data-hidden={props.hidden || undefined}>
      {props.lead}
      <div class="pc-ac-actionGroup pc-ac-hoverable">
        <ChatCopyAction nativeCopy={props.nativeCopy} text={props.copyText} labels={props.labels} />
        <Show when={props.onRetry}>
          <ChatAction label={labels().retry} disabled={props.retryDisabled} onClick={() => props.onRetry?.()}>
            <ChatIcon name="rotate" size={15} />
          </ChatAction>
        </Show>
      </div>
      <Show when={props.meta}>
        <span class="pc-ac-meta pc-ac-hoverable">{props.meta}</span>
      </Show>
    </div>
  )
}

/* ----------------------------------------------------------------- status */

export function ChatStatusLine(props: { answered: boolean; labels?: Partial<ChatLabels> }) {
  const labels = () => merge(props.labels)
  return (
    <p class="pc-ac-statusLine pc-ac-fadeIn" data-component="panacode-chat-stopped">
      <StopGlyph />
      {props.answered ? labels().stopped : labels().stoppedBeforeAnswer}
    </p>
  )
}

export function ChatError(props: { message: string; onRetry?: () => void; labels?: Partial<ChatLabels> }) {
  const labels = () => merge(props.labels)
  return (
    <div class="pc-ac-error pc-ac-fadeIn" role="alert" data-component="panacode-chat-error">
      <span class="pc-ac-errorIcon" style={{ display: "inline-flex" }}>
        <ChatIcon name="alert" size={16} />
      </span>
      <p class="pc-ac-errorText">
        <span class="pc-ac-errorTitle">{labels().failed}</span> {props.message}
      </p>
      <Show when={props.onRetry}>
        <Button variant="secondary" size="sm" onClick={() => props.onRetry?.()}>
          {labels().retry}
        </Button>
      </Show>
    </div>
  )
}

/* ------------------------------------------------------------- model menu */

export interface ChatModel {
  id: string
  name: string
  note?: string
  mark?: () => JSX.Element
}

/** Arc model menu items: mark, name, note, and a check on the current model. Hosts place it in their popover. */
export function ChatModelMenu(props: {
  models: ChatModel[]
  value?: string
  onChange: (id: string) => void
  label?: string
}) {
  return (
    <div class="pc-ac-menuList" role="listbox" aria-label={props.label} data-component="panacode-chat-model-menu">
      <Show when={props.label}>
        <div class="pc-ac-menuLabel">{props.label}</div>
      </Show>
      <For each={props.models}>
        {(model) => (
          <button
            type="button"
            role="option"
            aria-selected={model.id === props.value}
            class="pc-ac-menuItem"
            onClick={() => props.onChange(model.id)}
          >
            <Show when={model.mark !== undefined}>
              <span class="pc-ac-mark">{model.mark?.()}</span>
            </Show>
            <span class="pc-ac-menuName">{model.name}</span>
            <Show when={model.note}>
              <span class="pc-ac-menuNote">{model.note}</span>
            </Show>
            <span class="pc-ac-menuCheck">
              <Show when={model.id === props.value}>
                <ChatIcon name="check" size={15} />
              </Show>
            </span>
          </button>
        )}
      </For>
    </div>
  )
}

export { ChatIcon, StopGlyph } from "./icons"
