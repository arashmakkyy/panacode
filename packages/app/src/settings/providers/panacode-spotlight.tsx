import { createSignal, For, Show, type JSX } from "solid-js"
import { ProviderSpotlight } from "@panacode/ui/features/providers"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"

/** PanaAI dashboard, where credits are bought. */
const PANAAI_DASHBOARD_URL = "https://panaai-psi.vercel.app"

/** PanaAI, featured first in Settings → Providers. `connected` is the connection source, or undefined. */
export function PanaAISpotlight(props: {
  connected: "env" | "api" | "account" | "config" | "custom" | undefined
  sourceLabel?: string
  models: string[]
  onConnect: () => void
  accounts?: JSX.Element
  catalog?: string
  onRefresh: () => Promise<void>
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const [refreshing, setRefreshing] = createSignal(false)
  const [failed, setFailed] = createSignal(false)

  const refresh = async () => {
    if (refreshing()) return
    setRefreshing(true)

    try {
      await props.onRefresh()
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setRefreshing(false)
    }
  }

  const status = () =>
    props.connected === undefined ? "disconnected" : props.connected === "env" ? "environment" : "connected"

  return (
    <ProviderSpotlight
      name="PanaAI"
      monogram="Pa"
      badge={language.t("panacode.providers.panaai.badge")}
      description={language.t("panacode.providers.panaai.description")}
      status={status()}
      statusLabel={language.t(
        status() === "disconnected" ? "panacode.providers.panaai.notConnected" : "panacode.providers.panaai.connected",
      )}
      detail={status() === "environment" ? "PANAAI_API_KEY" : props.sourceLabel}
      primary={
        status() === "disconnected"
          ? { label: language.t("panacode.providers.panaai.connect"), onClick: props.onConnect }
          : {
              label: language.t("panacode.providers.panaai.topUp"),
              onClick: () => platform.openExternal(`${PANAAI_DASHBOARD_URL}/purchase`),
            }
      }
      secondary={
        status() === "disconnected"
          ? {
              label: language.t("panacode.providers.panaai.getKey"),
              onClick: () => platform.openExternal(PANAAI_DASHBOARD_URL),
            }
          : undefined
      }
      footer={
        <Show when={props.connected || failed() || (props.catalog && props.catalog !== "idle") || props.models.length}>
          {props.accounts}
          <Show when={failed() || props.catalog === "unavailable" || props.catalog === "unauthorized"}>
            <p role="status">
              {language.t(
                props.catalog === "unauthorized" ? "panacode.providers.authFailed" : "panacode.providers.catalogFailed",
              )}
            </p>
            <button
              type="button"
              disabled={refreshing()}
              onClick={() => (props.catalog === "unauthorized" ? props.onConnect() : void refresh())}
            >
              {language.t(props.catalog === "unauthorized" ? "dialog.provider.needsSignIn" : "common.retry")}
            </button>
          </Show>
          <Show when={props.catalog === "ready" && !props.models.length}>
            <p>{language.plural("panacode.providers.panaai.models", 0, { count: 0 })}</p>
          </Show>
          <Show when={props.models.length > 0}>
            <div data-slot="spotlight-models">
              <span data-slot="models-label">
                {language.plural("panacode.providers.panaai.models", props.models.length, {
                  count: props.models.length,
                })}
              </span>
              <div data-slot="models-list">
                <For each={props.models.slice(0, 8)}>{(model) => <span data-slot="model-chip">{model}</span>}</For>
                <Show when={props.models.length > 8}>
                  <span data-slot="model-chip" data-more>
                    +{props.models.length - 8}
                  </span>
                </Show>
              </div>
            </div>
          </Show>
        </Show>
      }
    />
  )
}
