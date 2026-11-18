import { For, Show, createMemo, createSignal } from "solid-js"
import { Button } from "../../primitives/button"
import { Input } from "../../primitives/input"
import { Switch } from "../../primitives/switch"
import "./mcp-servers.css"

export type McpServerView = {
  id: string
  name: string
  description?: string
  enabled: boolean
  connected: boolean
  error?: string
}

export interface McpServersProps {
  servers: readonly McpServerView[]
  onToggle: (id: string, enabled: boolean) => void
  onConnect?: (id: string) => void
  onDisconnect?: (id: string) => void
  onAdd?: () => void
  class?: string
  /** Caller-supplied copy (i18n). Avoid hardcoded product strings in this package. */
  labels: {
    title: string
    description: string
    add: string
    searchPlaceholder: string
    searchAria: string
    enabled: string
    connect: string
    disconnect: string
  }
}

/** MCP settings block — bind real MCP registry state in the app adapter. */
export function McpServers(props: McpServersProps) {
  const [query, setQuery] = createSignal("")
  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase()
    if (!q) return props.servers
    return props.servers.filter((server) => server.name.toLowerCase().includes(q) || server.description?.toLowerCase().includes(q))
  })

  return (
    <section data-component="panacode-mcp-servers" data-panacode-feature="mcp-servers" class={props.class}>
      <header data-slot="mcp-header">
        <div>
          <h3>{props.labels.title}</h3>
          <p>{props.labels.description}</p>
        </div>
        <Show when={props.onAdd}>
          <Button size="sm" onClick={() => props.onAdd?.()}>
            {props.labels.add}
          </Button>
        </Show>
      </header>
      <Input
        type="search"
        placeholder={props.labels.searchPlaceholder}
        value={query()}
        onInput={(event) => setQuery(event.currentTarget.value)}
        aria-label={props.labels.searchAria}
      />
      <ul data-slot="mcp-list">
        <For each={filtered()}>
          {(server) => (
            <li data-connected={server.connected ? "" : undefined}>
              <div data-slot="mcp-meta">
                <strong>{server.name}</strong>
                <Show when={server.description}>
                  <p>{server.description}</p>
                </Show>
                <Show when={server.error}>
                  <p data-slot="mcp-error">{server.error}</p>
                </Show>
              </div>
              <div data-slot="mcp-controls">
                <Switch checked={server.enabled} onChange={(checked) => props.onToggle(server.id, checked)}>
                  {props.labels.enabled}
                </Switch>
                <Show when={!server.connected}>
                  <Button size="sm" variant="secondary" onClick={() => props.onConnect?.(server.id)}>
                    {props.labels.connect}
                  </Button>
                </Show>
                <Show when={server.connected}>
                  <Button size="sm" variant="ghost" onClick={() => props.onDisconnect?.(server.id)}>
                    {props.labels.disconnect}
                  </Button>
                </Show>
              </div>
            </li>
          )}
        </For>
      </ul>
    </section>
  )
}
