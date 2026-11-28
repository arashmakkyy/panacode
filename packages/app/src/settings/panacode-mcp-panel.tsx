import { createMemo, createResource, onCleanup } from "solid-js"
import { McpServers, type McpAddRequest, type McpServersLabels } from "@panacode/ui/features/mcp-servers"
import { toMcpServerViews, type McpConfigLike } from "@panacode/ui/adapters/mcp-servers"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useMcpController } from "@/providers/connect/mcp"
import { mcpRowView } from "@/providers/connect/mcp-machine"
import { showToast } from "@/shell/notifications/toast"

import { runtimeMcpDetails } from "./mcp-runtime"

const listStates = { unresolved: "loading", pending: "loading", refreshing: "loading", ready: "ready", errored: "error" } as const

function sameLocation(a: { directory?: string; workspaceID?: string }, b: typeof a) {
  return a.directory === b.directory && a.workspaceID === b.workspaceID
}

/**
 * The Arc MCP Servers block on real MCP state: the server list and its live status, each server's config entry
 * (transport and a credential-free endpoint), the resource catalog, and the shared MCP controller for connect,
 * disconnect and sign-in. Add attaches a server to the running service (the API keeps it in memory for the workspace; nothing is written to config);
 * Remove detaches it after the undo window.
 */
export function PanacodeMcpPanel(props: { directory?: string }) {
  const language = useLanguage()
  const data = useData()
  const serverSdk = useServerSDK()
  const location = () => (props.directory ? { directory: props.directory } : data.location.default())
  const mcp = useMcpController(() => props.directory)
  const t = language.t

  const [listLoad, { refetch: reloadList }] = createResource(
    () => serverSdk.connection.status() === "connected" && location(),
    async (ref) => {
      await Promise.all([
        data.location.mcp.server.sync(ref),
        props.directory ? data.location.mcp.server.sync(data.location.default()) : undefined,
      ])

      return ref.directory
    },
  )

  const syncResources = () => data.location.mcp.resource.sync(location()).catch(() => undefined)
  createResource(() => serverSdk.connection.status() === "connected" && location(), syncResources)

  // Config entries say how each server is reached. Only the type, URL and command are read; headers and environment
  // never leave this function.
  const [config, { refetch }] = createResource(
    () => (serverSdk.connection.status() === "connected" ? (props.directory ?? "") : undefined),
    async (directory) => {
      const entries = await serverSdk.api.config
        .get(directory ? { location: { directory } } : undefined)
        .catch(() => [])

      const servers = new Map<string, McpConfigLike>()

      for (const entry of entries)
        if (entry.type === "document")
          for (const [name, value] of Object.entries(entry.info.mcp?.servers ?? {})) {
            servers.set(name, value.type === "remote" ? { type: "remote", url: value.url } : { type: "local", command: value.command })
          }

      return servers
    },
  )

  onCleanup(serverSdk.event.on("config.updated", () => void refetch()))

  const list = () => {
    const active = data.location.mcp.server.list(location())
    const defaults = data.location.mcp.server.list(data.location.default()) ?? []
    const merged = defaults.map((server) => active?.find((item) => item.name === server.name) ?? server)

    return [...merged, ...(active ?? []).filter((item) => !merged.some((server) => server.name === item.name))]
  }

  const raw = (id: string) => list().find((item) => item.name === id)

  const servers = createMemo(() =>
    toMcpServerViews(list(), {
      config: (name) =>
        (config.state === "ready" ? config()?.get(name) : undefined) ??
        runtimeMcpDetails(serverSdk, location(), name).get(),
      resources: data.location.mcp.resource.list(location()) ?? [],
      busy: (name) => mcpRowView(mcp.state(), name, raw(name)?.status.status).busy,
    }),
  )

  const toggle = (id: string, enabled: boolean) =>
    mcp.dispatch({ type: "toggle.requested", name: id, enabled, status: raw(id)?.status.status })

  const refresh = async () => {
    data.location.mcp.server.invalidate(location())
    data.location.mcp.resource.invalidate(location())

    if (props.directory) data.location.mcp.server.invalidate(data.location.default())
    await Promise.all([reloadList(), syncResources()])
    void refetch()
  }

  const add = async (request: McpAddRequest) => {
    const ref = location()

    const config =
      request.transport === "remote"
        ? { type: "remote" as const, url: request.url }
        : { type: "local" as const, command: request.command }

    await runtimeMcpDetails(serverSdk, ref, request.name).add(
      config,
      serverSdk.api.experimental.mcp.add({ server: request.name, location: ref, config }),
    )

    if (!sameLocation(ref, location())) return
    await refresh()

    // A server that needs OAuth starts its sign-in right away, as the Arc sheet's authorize step does.
    if (raw(request.name)?.status.status === "needs_auth") toggle(request.name, true)
  }

  const remove = (id: string) => {
    const ref = location()
    void runtimeMcpDetails(serverSdk, ref, id)
      .remove(serverSdk.api.experimental.mcp.remove({ server: id, location: ref }))
      .then(() => {
        if (!sameLocation(ref, location())) return

        return refresh()
      })
      .catch((cause: unknown) =>
        showToast({
          variant: "error",
          title: t("common.requestFailed"),
          description: cause instanceof Error ? cause.message : String(cause),
        }),
      )
  }

  const labels = (): Partial<McpServersLabels> => ({
    title: t("panacode.mcp.title"),
    add: t("panacode.mcp.add"),
    summary: (connected, total) => t("panacode.mcp.summary", { connected, total }),
    resources: (count) => language.plural("panacode.mcp.resources", count),
    status: {
      connected: t("panacode.mcp.status.connected"),
      connecting: t("panacode.mcp.status.connecting"),
      disabled: t("panacode.mcp.status.disabled"),
      "needs-auth": t("panacode.mcp.status.needsAuth"),
      error: t("panacode.mcp.status.error"),
    },
    transport: { remote: t("panacode.mcp.remote"), local: t("panacode.mcp.local") },
    signIn: t("panacode.mcp.signIn"),
    retry: t("panacode.mcp.retry"),
    remove: t("panacode.mcp.remove"),
    removed: (name) => t("panacode.mcp.removed", { name }),
    undo: t("panacode.mcp.undo"),
    toggle: (name) => t("panacode.mcp.toggle", { name }),
    details: (name) => t("panacode.mcp.details", { name }),
    noResources: t("panacode.mcp.noResources"),
    resourcesHeading: t("panacode.mcp.resourcesHeading"),
    emptyTitle: t("panacode.mcp.emptyTitle"),
    emptyBody: t("panacode.mcp.emptyBody"),
    sheetTitle: t("panacode.mcp.sheetTitle"),
    close: t("panacode.mcp.close"),
    name: t("panacode.mcp.name"),
    namePlaceholder: t("panacode.mcp.namePlaceholder"),
    url: t("panacode.mcp.url"),
    urlPlaceholder: t("panacode.mcp.urlPlaceholder"),
    command: t("panacode.mcp.command"),
    commandPlaceholder: t("panacode.mcp.commandPlaceholder"),
    connect: t("panacode.mcp.connect"),
    connecting: t("panacode.mcp.adding"),
    nameTaken: t("panacode.mcp.nameTaken"),
    invalidUrl: t("panacode.mcp.invalidUrl"),
    invalidCommand: t("panacode.mcp.invalidCommand"),
    filterTitle: t("panacode.mcp.filters"),
    filters: { all: t("panacode.mcp.all"), connected: t("panacode.mcp.status.connected"), other: t("panacode.mcp.other") },
    noMatches: t("panacode.mcp.noMatches"),
    removedCount: (count) => t("panacode.mcp.removedCount", { count }),
    restored: (count) => language.plural("panacode.mcp.restored", count, { count }),
    invalidName: t("panacode.mcp.invalidName"),
    sheetNote: t("panacode.mcp.sheetNote"),
  })

  return (
    <div data-component="panacode-mcp-panel" class="settings-section">
      <McpServers
        servers={servers()}
        listState={listStates[listLoad.state]}
        listMessage={listLoad.state === "errored" ? t("common.requestFailed") : t("common.loading")}
        onReload={() => void refresh()}
        labels={labels()}
        onToggle={toggle}
        onSignIn={(id) => toggle(id, true)}
        onRetry={(id) => toggle(id, true)}
        onRemove={remove}
        onAdd={add}
      />
    </div>
  )
}
