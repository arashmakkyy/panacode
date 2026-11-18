import { For, Show } from "solid-js"
import { ProviderSpotlight } from "@panacode/ui/features/providers"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"

export const PANAAI_PROVIDER_ID = "panaai"
/** PanaAI dashboard, where credits are bought. Kept beside the provider id so a domain move is one edit. */
const PANAAI_DASHBOARD_URL = "https://panaai-psi.vercel.app"

/** PanaAI, featured first in Settings → Providers. `connected` is the connection source, or undefined. */
export function PanaAISpotlight(props: {
  connected: "env" | "api" | "account" | "config" | "custom" | undefined
  models: string[]
  onConnect: () => void
  onDisconnect?: () => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const status = () => (props.connected === undefined ? "disconnected" : props.connected === "env" ? "environment" : "connected")
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
      detail={
        status() === "environment"
          ? "PANAAI_API_KEY"
          : status() === "connected"
            ? language.t("panacode.providers.panaai.viaKey")
            : undefined
      }
      primary={
        status() === "disconnected"
          ? { label: language.t("panacode.providers.panaai.connect"), onClick: props.onConnect }
          : { label: language.t("panacode.providers.panaai.topUp"), onClick: () => platform.openExternal(`${PANAAI_DASHBOARD_URL}/purchase`) }
      }
      secondary={
        status() === "disconnected"
          ? { label: language.t("panacode.providers.panaai.getKey"), onClick: () => platform.openExternal(PANAAI_DASHBOARD_URL) }
          : props.onDisconnect
            ? { label: language.t("common.disconnect"), onClick: props.onDisconnect }
            : { label: language.t("panacode.providers.panaai.manage"), onClick: props.onConnect }
      }
      footer={
        <Show when={props.models.length > 0}>
          <div data-slot="spotlight-models">
            <span data-slot="models-label">
              {language.plural("panacode.providers.panaai.models", props.models.length, { count: props.models.length })}
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
      }
    />
  )
}
