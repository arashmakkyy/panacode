import { Component, For, Show, createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Tabs } from "@opencode/ui/tabs"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { ServerConnection } from "@/runtime/server/registry"
import { ExtensionPlugins } from "@/runtime/plugin/extension-plugins"
import { ExternalLink } from "@/runtime/platform/external-link"
import { usePlatform } from "@/runtime/platform/platform"
import { SettingsList } from "@/settings/list"
import { createExtensionLoad, ExtensionLoadFailed } from "@/settings/extension-load"
import type { SettingsView } from "@/settings/surface"
import { ConsoleName, createConsoleSources } from "./console-link"
import { PanacodeMcpPanel } from "@/settings/panacode-mcp-panel"
import "@/settings/settings.css"
import "@/shell/search-list.css"

export const SettingsExtensions: Component<{
  directory?: string
  subtab?: SettingsView["subtab"]
  onSubtab: (value: SettingsView["subtab"]) => void
  headerAction?: JSX.Element
}> = (props) => {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const data = useData()
  const platform = usePlatform()
  const sources = createConsoleSources(() => props.directory)

  const plugins = createExtensionLoad({
    key: () => serverSdk.scope,
    task: (_, signal) => serverSdk.api.plugin.list(undefined, { signal }).then((result) => result.data),
  })

  onCleanup(
    serverSdk.event.on("plugin.updated", (event) => {
      if (!event.location) plugins.invalidate()
    }),
  )

  const pluginList = createMemo(() => {
    const current = plugins.view()

    return current.status === "ready" ? current.value : undefined
  })

  // The desktop window runs the GUIs of its own server's plugins, so only that server's rows control them.
  const own = () => !!platform.plugins && ServerConnection.builtin(serverSdk.server)

  createEffect(() => {
    if (serverSdk.connection.status() !== "connected") return
    void data.location.skill.sync().catch(() => undefined)
  })
  const skills = createMemo(() => (data.location.skill.list() ?? []).toSorted((a, b) => a.name.localeCompare(b.name)))

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex min-w-0 flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.tab.extensions")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.extensions.description")}</span>
          </div>
          <div class="settings-tab-header-actions">{props.headerAction}</div>
        </div>
      </div>

      <div class="settings-tab-body">
        <Tabs
          variant="pill"
          value={props.subtab ?? "mcps"}
          onChange={(value) => {
            if (value === "mcps" || value === "plugins" || value === "skills") props.onSubtab(value)
          }}
          class="settings-extensions-tabs settings-subtabs"
        >
          <Tabs.List>
            <Tabs.Trigger value="mcps">{language.t("settings.extensions.tab.mcps")}</Tabs.Trigger>
            <Tabs.Trigger value="plugins">{language.t("settings.extensions.tab.plugins")}</Tabs.Trigger>
            <Tabs.Trigger value="skills">{language.t("settings.extensions.tab.skills")}</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="mcps">
            {/* Panacode presentation adapter — MCP controllers/state remain upstream OpenCode. */}
            <PanacodeMcpPanel directory={props.directory} />
            <Show when={sources.view().status === "error"}>
              <ExtensionLoadFailed
                message={language.t("settings.extensions.sources.loadFailed")}
                retry={language.t("common.retry")}
                onRetry={sources.retry}
              />
            </Show>
          </Tabs.Content>

          <Tabs.Content value="plugins">
            <div class="settings-section">
              <div class="flex items-center justify-between">
                <span class="settings-extension-heading text-13-medium">
                  {language.t("settings.extensions.availableAll")}
                </span>
                <span class="text-13-regular text-v2-text-text-muted">
                  {language.t("settings.extensions.manageConfig")}
                </span>
              </div>
              {/* The desktop's own server also lists the plugins main runs, so its rows stay while the list loads. */}
              <Show when={own() || pluginList()}>
                <ExtensionPlugins plugins={pluginList() ?? []} own={own()} />
              </Show>
              <Show when={plugins.view().status === "loading" && !own()}>
                <p class="project-settings-extension-empty-description">{language.t("common.loading")}</p>
              </Show>
              <Show when={plugins.view().status === "error"}>
                <ExtensionLoadFailed
                  message={language.t("settings.extensions.plugins.loadFailed")}
                  retry={language.t("common.retry")}
                  onRetry={plugins.retry}
                />
              </Show>
            </div>
          </Tabs.Content>

          <Tabs.Content value="skills">
            <div class="settings-section">
              <div class="flex items-center justify-between">
                <span class="settings-extension-heading text-13-medium">
                  {language.t("settings.extensions.availableAll")}
                </span>
                <ExternalLink class="settings-extension-link text-13-regular" href="https://opencode.ai/docs/skills">
                  {language.t("settings.extensions.addSkills")}
                </ExternalLink>
              </div>
              <SettingsList variant="catalog">
                <For each={skills()}>
                  {(skill) => {
                    const link = () => sources.skill(skill)

                    return (
                      <div class="settings-extension-row">
                        <div class="settings-extension-lead">
                          <Icon name="post-skill" class="text-v2-icon-icon-muted shrink-0" />
                          <Show
                            when={link()}
                            fallback={<span class="settings-extension-name truncate">{skill.name}</span>}
                          >
                            {(href) => <ConsoleName name={skill.name} href={href()} />}
                          </Show>
                        </div>
                      </div>
                    )
                  }}
                </For>
              </SettingsList>
              <Show when={sources.view().status === "error"}>
                <ExtensionLoadFailed
                  message={language.t("settings.extensions.sources.loadFailed")}
                  retry={language.t("common.retry")}
                  onRetry={sources.retry}
                />
              </Show>
            </div>
          </Tabs.Content>
        </Tabs>
      </div>
    </>
  )
}
