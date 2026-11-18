import { createEffect, createMemo, Show } from "solid-js"
import { useDialog } from "@opencode/ui/context/dialog"
import { McpServers } from "@panacode/ui/features/mcp-servers"
import { toMcpServerViews } from "@panacode/ui/adapters/mcp-servers"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useMcpController } from "@/providers/connect/mcp"
import { DialogMcp } from "@/providers/connect/mcp-dialog"

/**
 * Panacode presentation adapter for MCP settings.
 * Keeps OpenCode MCP controllers/state; only the chrome is Panacode-owned.
 */
export function PanacodeMcpPanel(props: { directory?: string }) {
  const language = useLanguage()
  const data = useData()
  const serverSdk = useServerSDK()
  const dialog = useDialog()
  const location = () => (props.directory ? { directory: props.directory } : data.location.default())
  const mcp = useMcpController(() => props.directory)

  createEffect(() => {
    if (serverSdk.connection.status() !== "connected") return
    void data.location.mcp.server.sync(data.location.default()).catch(() => undefined)
    if (props.directory) void data.location.mcp.server.sync(location()).catch(() => undefined)
  })

  const servers = createMemo(() => {
    const active = data.location.mcp.server.list(location())
    const defaults = data.location.mcp.server.list(data.location.default()) ?? []
    const merged = defaults.map((server) => active?.find((item) => item.name === server.name) ?? server)
    return toMcpServerViews(merged)
  })

  const raw = (id: string) => {
    const active = data.location.mcp.server.list(location())
    return (
      active?.find((item) => item.name === id) ??
      data.location.mcp.server.list(data.location.default())?.find((item) => item.name === id)
    )
  }

  return (
    <div data-component="panacode-mcp-panel" class="settings-section">
      <McpServers
        servers={servers()}
        onToggle={(id, enabled) => {
          const item = raw(id)
          if (!item) return
          mcp.dispatch({
            type: "toggle.requested",
            name: id,
            enabled,
            status: item.status.status,
          })
        }}
        onConnect={(id) => {
          const item = raw(id)
          if (item?.status.status === "failed") {
            dialog.show(() => <DialogMcp directory={location().directory} server={id} />)
            return
          }
          mcp.dispatch({ type: "toggle.requested", name: id, enabled: true, status: item?.status.status ?? "needs_auth" })
        }}
        onDisconnect={(id) => {
          const item = raw(id)
          if (!item) return
          mcp.dispatch({ type: "toggle.requested", name: id, enabled: false, status: item.status.status })
        }}
        onAdd={() => dialog.show(() => <DialogMcp directory={location().directory} />)}
        labels={{
          title: language.t("settings.extensions.tab.mcps"),
          description: language.t("settings.extensions.description"),
          add: language.t("dialog.mcp.title"),
          searchPlaceholder: language.t("settings.extensions.tab.mcps"),
          searchAria: language.t("settings.extensions.tab.mcps"),
          enabled: language.t("mcp.status.connected"),
          connect: language.t("dialog.mcp.signIn"),
          disconnect: language.t("mcp.status.disabled"),
        }}
      />
      <Show when={servers().length === 0}>
        <p class="text-11-regular text-v2-text-text-muted">{language.t("settings.extensions.manageConfig")}</p>
      </Show>
    </div>
  )
}
