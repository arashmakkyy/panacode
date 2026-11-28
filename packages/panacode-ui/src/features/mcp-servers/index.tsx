import { createEffect, createMemo, createSignal, createUniqueId, For, Match, on, onCleanup, onMount, Show, Switch as Branch, type JSX } from "solid-js"
import { parseMcpCommand } from "./command"
import { Switch } from "../../primitives/switch"
import { SegmentedControl } from "../../primitives/segmented-control"
import { brandGlyphs, mcpGlyph, type McpBrand } from "./brand-glyphs"
import {
  defaultMcpServersLabels,
  type McpAddRequest,
  type McpServerStatus,
  type McpServerView,
  type McpServersLabels,
  type McpTransport,
} from "./types"
import "./mcp-servers.css"

export * from "./types"
export { guessBrand } from "./brand-glyphs"

/**
 * Solid port of the Arc MCP Servers block, wired by the host to real MCP state: each row is a configured server with
 * its live status, the switch connects or disconnects it, Sign in and Retry run the host's sign-in flow, and the
 * panel lists the resources the server shares. Remove waits out an undo window before it calls the host. Add server
 * opens a sheet that attaches a remote URL or a local command.
 *
 * The backend reports no per-server tool list or token cost, so the Arc tool switches and context budget are not
 * drawn; the meter shows each server's state instead.
 */
export interface McpServersProps {
  listState?: "loading" | "ready" | "error"
  listMessage?: string
  onReload?: () => void
  servers: readonly McpServerView[]
  labels?: Partial<McpServersLabels>
  onToggle: (id: string, enabled: boolean) => void
  onSignIn?: (id: string) => void
  onRetry?: (id: string) => void
  /** Called once a removal's undo window closes (6 seconds, held while the pointer or focus rests on the bar). */
  onRemove?: (id: string) => void
  /** Resolve when the server is saved; reject with a message to show in the sheet. */
  onAdd?: (request: McpAddRequest) => Promise<void>
  class?: string
}

const UNDO_MS = 6000

const Lucide = (props: { size?: number; children: JSX.Element; class?: string }) => (
  <svg
    class={props.class}
    width={props.size ?? 16}
    height={props.size ?? 16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {props.children}
  </svg>
)
const icons = {
  plus: () => <path d="M5 12h14M12 5v14" />,
  chevron: () => <path d="m6 9 6 6 6-6" />,
  check: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  key: () => (
    <>
      <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
      <path d="m21 2-9.6 9.6" />
      <circle cx="7.5" cy="15.5" r="5.5" />
    </>
  ),
  alert: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
  off: () => <circle cx="12" cy="12" r="10" />,
  loader: () => <path d="M21 12a9 9 0 1 1-6.219-8.56" />,
  trash: () => (
    <>
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  undo: () => (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11" />
    </>
  ),
  x: () => <path d="M18 6 6 18M6 6l12 12" />,
  file: () => (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </>
  ),
}

/** A brand's mark from Simple Icons, or the MCP mark. */
export function McpMark(props: { brand?: McpBrand; size?: number; class?: string }) {
  const paths = () => (props.brand ? brandGlyphs[props.brand].paths : mcpGlyph)
  return (
    <svg class={props.class} width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <For each={paths()}>{(d) => <path d={d} fill-rule={props.brand ? undefined : "evenodd"} />}</For>
    </svg>
  )
}

function StatusIcon(props: { status: McpServerStatus }) {
  return (
    <Branch>
      <Match when={props.status === "connected"}>
        <Lucide size={13}>{icons.check()}</Lucide>
      </Match>
      <Match when={props.status === "connecting"}>
        <Lucide size={13} class="pc-mcp-spin">
          {icons.loader()}
        </Lucide>
      </Match>
      <Match when={props.status === "needs-auth"}>
        <Lucide size={13}>{icons.key()}</Lucide>
      </Match>
      <Match when={props.status === "error"}>
        <Lucide size={13}>{icons.alert()}</Lucide>
      </Match>
      <Match when={props.status === "disabled"}>
        <Lucide size={13}>{icons.off()}</Lucide>
      </Match>
    </Branch>
  )
}

const NAME = /^[a-zA-Z0-9_-]+$/
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
/** A name for the server from its URL host or command, when the field is left empty. */
export function suggestMcpName(transport: McpTransport, value: string) {
  if (transport === "remote") {
    try {
      const host = new URL(value.trim()).hostname.replace(/^(www|mcp|api)\./, "")
      return slug(host.split(".")[0] ?? "")
    } catch {
      return ""
    }
  }
  const words = (parseMcpCommand(value) ?? []).filter((word) => !word.startsWith("-"))
  const pkg = words.find((word) => word.includes("/") || word.includes("server")) ?? words[0] ?? ""
  return slug(pkg.split("/").at(-1)?.replace(/@.*$/, "").replace(/\.[a-z]+$/i, "").replace(/^server-|-server$/g, "") ?? "")
}

export function McpServers(props: McpServersProps) {
  const labels = () => ({ ...defaultMcpServersLabels, ...props.labels })
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
  const [removal, setRemoval] = createSignal<{ servers: McpServerView[]; key: number }>()
  const [hovered, setHovered] = createSignal(false)
  const [focused, setFocused] = createSignal(false)
  const held = () => hovered() || focused()
  const [filter, setFilter] = createSignal<"all" | "connected" | "other">("all")
  const filters = ["all", "connected", "other"] as const
  const [sheet, setSheet] = createSignal(false)
  const [announce, setAnnounce] = createSignal("")
  let timer: ReturnType<typeof setTimeout> | undefined
  let opener: HTMLButtonElement | undefined
  const open = (event: MouseEvent & { currentTarget: HTMLButtonElement }) => {
    opener = event.currentTarget
    setSheet(true)
  }
  const close = () => {
    setSheet(false)
    queueMicrotask(() => opener?.focus({ preventScroll: true }))
  }
  let key = 0
  const rows = new Map<string, HTMLElement>()

  const visible = createMemo(() => props.servers.filter((server) => !removal()?.servers.some((removed) => removed.id === server.id)))
  const connected = createMemo(() => visible().filter((server) => server.status === "connected").length)
  const resources = createMemo(() =>
    visible()
      .filter((server) => server.status === "connected")
      .reduce((sum, server) => sum + server.resources.length, 0),
  )

  const filtered = createMemo(() => visible().filter((server) =>
    filter() === "all" || (filter() === "connected") === (server.status === "connected")))
  const countFor = (value: typeof filters[number]) =>
    value === "all" ? visible().length : value === "connected" ? connected() : visible().length - connected()
  const removedLabel = (servers: McpServerView[]) => servers.length === 1 ? labels().removed(servers[0].name) : labels().removedCount(servers.length)
  let remaining = UNDO_MS
  let started = 0
  let previousKey = 0
  const finish = () => {
    clearTimeout(timer)
    const current = removal()
    setRemoval(undefined)
    current?.servers.forEach((server) => props.onRemove?.(server.id))
  }
  createEffect(on([held, () => removal()?.key], ([paused, batch]) => {
    clearTimeout(timer)
    if (!batch) return
    const now = performance.now()
    if (batch !== previousKey) remaining = UNDO_MS
    else if (started) remaining = Math.max(0, remaining - (now - started))
    previousKey = batch
    started = paused ? 0 : now
    if (!paused) timer = setTimeout(finish, remaining)
  }))
  onCleanup(() => {
    clearTimeout(timer)
    removal()?.servers.forEach((server) => props.onRemove?.(server.id))
  })

  const remove = (server: McpServerView) => {
    const group = [...(removal()?.servers ?? []), server]
    setHovered(false)
    setFocused(false)
    setRemoval({ servers: group, key: ++key })
    setAnnounce(removedLabel(group))
  }
  const undo = () => {
    const current = removal()
    clearTimeout(timer)
    setRemoval(undefined)
    if (current) {
      setAnnounce(labels().restored(current.servers.length))
      queueMicrotask(() => rows.get(current.servers.at(-1)!.id)?.querySelector<HTMLElement>(".pc-mcp-rowMain")?.focus())
    }
  }
  const undoKey = (event: KeyboardEvent) => {
    if (!removal() || event.defaultPrevented || event.shiftKey || event.altKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return
    if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable=true]')) return
    event.preventDefault()
    undo()
  }
  createEffect(() => {
    if (!removal()) return
    window.addEventListener("keydown", undoKey)
    onCleanup(() => window.removeEventListener("keydown", undoKey))
  })

  const toggleOpen = (id: string) =>
    setExpanded((all) => {
      const next = new Set(all)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <section class={`pc-mcp ${props.class ?? ""}`} data-component="panacode-mcp-servers" data-sheet={sheet() ? "" : undefined}>
      <div class="pc-mcp-body">
        <header class="pc-mcp-header">
          <h2 class="pc-mcp-title">
            <McpMark size={18} />
            {labels().title}
          </h2>
          <Show when={props.onAdd}>
            <button type="button" class="pc-mcp-button" data-action="mcp-add" aria-haspopup="dialog" onClick={open}>
              <Lucide>{icons.plus()}</Lucide>
              {labels().add}
            </button>
          </Show>
        </header>

        <Show when={visible().length > 0}>
          <div class="pc-mcp-meter">
            <div class="pc-mcp-meterText">
              <span>
                <strong class="pc-mcp-num">{labels().summary(connected(), visible().length)}</strong>
                <Show when={resources() > 0}>
                  <span class="pc-mcp-sep" aria-hidden="true">
                    ·
                  </span>
                  <span class="pc-mcp-num">{labels().resources(resources())}</span>
                </Show>
              </span>
            </div>
            <div class="pc-mcp-bar" aria-hidden="true">
              <For each={visible()}>{(server) => <span class={`pc-mcp-seg is-${server.status}`} title={server.name} />}</For>
            </div>
          </div>
        </Show>

        <Show when={visible().length}>
          <div class="pc-mcp-filters" role="group" aria-label={labels().filterTitle}>
            <For each={filters}>{(value) => <button type="button" aria-pressed={filter() === value} onClick={() => setFilter(value)}>
              {labels().filters[value]} <span>{countFor(value)}</span>
            </button>}</For>
          </div>
          <Show when={!filtered().length}><p class="pc-mcp-emptyText" role="status">{labels().noMatches}</p></Show>
        </Show>
        <ul class="pc-mcp-list">
          <For each={filtered()}>
            {(server) => (
              <ServerRow
                server={server}
                open={expanded().has(server.id)}
                labels={labels()}
                ref={(el) => rows.set(server.id, el)}
                onOpen={() => toggleOpen(server.id)}
                onToggle={(enabled) => props.onToggle(server.id, enabled)}
                onSignIn={props.onSignIn ? () => props.onSignIn?.(server.id) : undefined}
                onRetry={props.onRetry ? () => props.onRetry?.(server.id) : undefined}
                onRemove={props.onRemove ? () => remove(server) : undefined}
              />
            )}
          </For>
        </ul>

        <Show when={props.listState === "loading" || props.listState === "error"}>
          <div class="pc-mcp-empty" role={props.listState === "error" ? "alert" : "status"}>
            <p>{props.listMessage}</p>
            <Show when={props.listState === "error"}>
              <button type="button" class="pc-mcp-button" onClick={props.onReload}>{labels().retry}</button>
            </Show>
          </div>
        </Show>
        <Show when={visible().length === 0 && (props.listState ?? "ready") === "ready"}>
          <div class="pc-mcp-empty">
            <McpMark size={28} class="pc-mcp-emptyMark" />
            <p class="pc-mcp-emptyTitle">{labels().emptyTitle}</p>
            <p class="pc-mcp-emptyText">{labels().emptyBody}</p>
            <Show when={props.onAdd}>
              <button type="button" class="pc-mcp-button" aria-haspopup="dialog" onClick={open}>
                <Lucide>{icons.plus()}</Lucide>
                {labels().add}
              </button>
            </Show>
          </div>
        </Show>

        <Show when={removal()}>
          {(current) => (
            <div
              class="pc-mcp-undo"
              onPointerEnter={() => setHovered(true)}
              onPointerLeave={() => setHovered(false)}
              onFocusIn={() => setFocused(true)}
              onFocusOut={(event) => setFocused(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))}
            >
              <McpMark brand={current().servers.at(-1)?.brand} size={16} class="pc-mcp-undoMark" />
              <p>{removedLabel(current().servers)}</p>
              <button type="button" class="pc-mcp-ghost" onClick={undo}>
                <Lucide size={15}>{icons.undo()}</Lucide>
                {labels().undo}
              </button>
              <For each={[current().key]}>{() => <span class="pc-mcp-undoTimer" classList={{ "is-held": held() }} style={{ "animation-duration": `${UNDO_MS}ms` }} />}</For>
            </div>
          )}
        </Show>
      </div>

      <Show when={sheet() && props.onAdd}>
        {(add) => (
          <AddSheet
            labels={labels()}
            taken={(name) => props.servers.some((server) => server.id === name)}
            onClose={close}
            onSubmit={async (request) => {
              await add()(request)
              close()
              setAnnounce(request.name)
              setExpanded((all) => new Set([...all, request.name]))
              queueMicrotask(() => rows.get(request.name)?.querySelector<HTMLElement>(".pc-mcp-rowMain")?.focus())
            }}
          />
        )}
      </Show>

      <p class="pc-mcp-sr" role="status" aria-live="polite">
        {announce()}
      </p>
    </section>
  )
}

function ServerRow(props: {
  server: McpServerView
  open: boolean
  labels: McpServersLabels
  ref: (el: HTMLElement) => void
  onOpen: () => void
  onToggle: (enabled: boolean) => void
  onSignIn?: () => void
  onRetry?: () => void
  onRemove?: () => void
}) {
  const id = createUniqueId()
  const status = () => props.server.status
  const on = () => status() === "connected" || status() === "connecting"
  return (
    <li ref={props.ref} class="pc-mcp-row" classList={{ "is-open": props.open }} data-status={status()} data-server={props.server.id}>
      <div class="pc-mcp-rowHead">
        <button
          type="button"
          class="pc-mcp-rowMain"
          aria-expanded={props.open}
          aria-controls={`${id}-panel`}
          aria-label={props.labels.details(props.server.name)}
          onClick={props.onOpen}
        >
          <span class="pc-mcp-mark" classList={{ "is-generic": !props.server.brand }}>
            <McpMark brand={props.server.brand} size={18} />
          </span>
          <span class="pc-mcp-identity">
            <span class="pc-mcp-name">{props.server.name}</span>
            <span class="pc-mcp-meta">
              <span class={`pc-mcp-status is-${status()}`}>
                <StatusIcon status={status()} />
                <span classList={{ "pc-mcp-shimmer": status() === "connecting" }}>{props.labels.status[status()]}</span>
              </span>
              <Show when={props.server.transport}>
                {(transport) => (
                  <>
                    <span class="pc-mcp-sep" aria-hidden="true">
                      ·
                    </span>
                    <span>{props.labels.transport[transport()]}</span>
                  </>
                )}
              </Show>
            </span>
          </span>
          <span class="pc-mcp-count">
            <Show when={status() === "connected"}>
              <span class="pc-mcp-num">{props.labels.resources(props.server.resources.length)}</span>
            </Show>
          </span>
        </button>
        <div class="pc-mcp-actions">
          <Branch>
            <Match when={status() === "needs-auth" && props.onSignIn}>
              <button type="button" class="pc-mcp-button is-sm" data-action="mcp-sign-in" disabled={props.server.busy} onClick={() => props.onSignIn?.()}>
                <Lucide size={15}>{icons.key()}</Lucide>
                {props.labels.signIn}
              </button>
            </Match>
            <Match when={status() === "error" && props.onRetry}>
              <button type="button" class="pc-mcp-button is-sm" data-action="mcp-retry" disabled={props.server.busy} onClick={() => props.onRetry?.()}>
                {props.labels.retry}
              </button>
            </Match>
            <Match when={true}>
              <Switch
                class="pc-mcp-switch"
                checked={on()}
                disabled={props.server.busy || status() === "connecting"}
                onChange={(value: boolean) => props.onToggle(value)}
                hideLabel
              >
                {props.labels.toggle(props.server.name)}
              </Switch>
            </Match>
          </Branch>
          <button type="button" class="pc-mcp-chevron" tabindex="-1" aria-hidden="true" onClick={props.onOpen}>
            <Lucide size={16} class={props.open ? "is-up" : undefined}>
              {icons.chevron()}
            </Lucide>
          </button>
        </div>
      </div>

      <div id={`${id}-panel`} class="pc-mcp-panelClip" data-open={props.open ? "" : undefined}>
        <div class="pc-mcp-panel" inert={!props.open || undefined}>
          <Show when={props.server.error && (status() === "error" || status() === "needs-auth")}>
            <p class="pc-mcp-error">{props.server.error}</p>
          </Show>
          <Show when={status() === "connected"}>
            <p class="pc-mcp-panelHead">{props.labels.resourcesHeading}</p>
            <Show when={props.server.resources.length > 0} fallback={<p class="pc-mcp-muted">{props.labels.noResources}</p>}>
              <ul class="pc-mcp-resources">
                <For each={props.server.resources}>
                  {(resource) => (
                    <li title={resource.uri}>
                      <Lucide size={14}>{icons.file()}</Lucide>
                      <code>{resource.name}</code>
                      <Show when={resource.description}>
                        <span class="pc-mcp-muted">{resource.description}</span>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
          <div class="pc-mcp-panelFoot">
            <Show when={props.server.endpoint} fallback={<span />}>
              <code class="pc-mcp-endpoint" title={props.server.endpoint}>
                {props.server.endpoint}
              </code>
            </Show>
            <Show when={props.onRemove}>
              <button type="button" class="pc-mcp-ghost is-danger" data-action="mcp-remove" onClick={() => props.onRemove?.()}>
                <Lucide size={15}>{icons.trash()}</Lucide>
                {props.labels.remove}
              </button>
            </Show>
          </div>
        </div>
      </div>
    </li>
  )
}

function AddSheet(props: {
  labels: McpServersLabels
  taken: (name: string) => boolean
  onClose: () => void
  onSubmit: (request: McpAddRequest) => Promise<void>
}) {
  const id = createUniqueId()
  const [transport, setTransport] = createSignal<McpTransport>("remote")
  const [name, setName] = createSignal("")
  const [targets, setTargets] = createSignal({ local: "", remote: "" })
  const target = () => targets()[transport()]
  const setTarget = (value: string) => setTargets((drafts) => ({ ...drafts, [transport()]: value }))
  const [error, setError] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  let modal!: HTMLDialogElement
  let field: HTMLInputElement | undefined

  const suggested = () => suggestMcpName(transport(), target())
  const finalName = () => name().trim() || suggested()

  const valid = createMemo(() => {
    if (transport() === "local") return !!parseMcpCommand(target())
    try { return ["http:", "https:"].includes(new URL(target()).protocol) } catch { return false }
  })
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      if (!busy()) { modal.close(); props.onClose() }
      return
    }
    if (event.key !== "Tab") return
    const stops = [...modal.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")].filter((item) => item.tabIndex >= 0)
    const first = stops[0], last = stops.at(-1)
    if (!first || (event.shiftKey ? document.activeElement !== first : document.activeElement !== last)) return
    event.preventDefault()
    ;(event.shiftKey ? last : first)?.focus()
  }
  onMount(() => {
    modal.showModal()
    field?.focus()
  })

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (busy()) return
    const value = target().trim()
    const label = finalName()
    if (transport() === "remote") {
      let ok = false
      try {
        const url = new URL(value)
        ok = url.protocol === "http:" || url.protocol === "https:"
      } catch {}
      if (!ok) return setError(props.labels.invalidUrl)
    } else if (!parseMcpCommand(value)) return setError(props.labels.invalidCommand)
    if (!NAME.test(label)) return setError(props.labels.invalidName)
    if (props.taken(label)) return setError(props.labels.nameTaken)
    setError("")
    setBusy(true)
    try {
      await props.onSubmit(
        transport() === "remote"
          ? { name: label, transport: "remote", url: value }
          : { name: label, transport: "local", command: parseMcpCommand(value)! },
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={modal} class="pc-mcp-layer" aria-labelledby={`${id}-title`} onKeyDown={onKey}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!busy()) props.onClose() }}>

      <div class="pc-mcp-scrim" aria-hidden="true" onClick={() => !busy() && props.onClose()} />
      <div class="pc-mcp-sheet">
        <header class="pc-mcp-sheetHead">
          <span />
          <h3 id={`${id}-title`}>{props.labels.sheetTitle}</h3>
          <button type="button" class="pc-mcp-icon" aria-label={props.labels.close} onClick={props.onClose} disabled={busy()}>
            <Lucide>{icons.x()}</Lucide>
          </button>
        </header>
        <form class="pc-mcp-form" onSubmit={submit} novalidate>
          <SegmentedControl
            disabled={busy()}
            aria-label={props.labels.sheetTitle}
            options={[
              { value: "remote", label: props.labels.transport.remote },
              { value: "local", label: props.labels.transport.local },
            ]}
            value={transport()}
            onChange={(value) => {
              setTransport(value)
              setError("")
              queueMicrotask(() => field?.focus())
            }}
          />
          <label class="pc-mcp-field">
            <span>{transport() === "remote" ? props.labels.url : props.labels.command}</span>
            <input
              ref={field}
              class="pc-mcp-input is-mono"
              data-action="mcp-add-target"
              value={target()}
              placeholder={transport() === "remote" ? props.labels.urlPlaceholder : props.labels.commandPlaceholder}
              disabled={busy()}
              spellcheck={false}
              autocomplete="off"
              onInput={(event) => {
                setTarget(event.currentTarget.value)
                setError("")
              }}
            />
          </label>
          <label class="pc-mcp-field">
            <span>{props.labels.name}</span>
            <input
              class="pc-mcp-input"
              data-action="mcp-add-name"
              value={name()}
              placeholder={suggested() || props.labels.namePlaceholder}
              disabled={busy()}
              spellcheck={false}
              autocomplete="off"
              onInput={(event) => {
                setName(event.currentTarget.value)
                setError("")
              }}
            />
          </label>
          <p class="pc-mcp-formError" role="alert">
            {error()}
          </p>
          <footer class="pc-mcp-sheetFoot">
            <p class="pc-mcp-muted">{props.labels.sheetNote}</p>
            <button type="submit" class="pc-mcp-button is-primary" data-action="mcp-add-submit" disabled={busy() || !valid()} aria-busy={busy()}>
              <Show when={busy()}>
                <Lucide size={15} class="pc-mcp-spin">
                  {icons.loader()}
                </Lucide>
              </Show>
              {busy() ? props.labels.connecting : props.labels.connect}
            </button>
          </footer>
        </form>
      </div>
    </dialog>
  )
}
