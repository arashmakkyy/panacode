import { Show, type JSX } from "solid-js"
import "./providers.css"

export type ProviderSpotlightStatus = "connected" | "environment" | "disconnected"

export interface ProviderSpotlightProps {
  name: string
  badge?: string
  description: string
  status: ProviderSpotlightStatus
  statusLabel: string
  /** Shown under the status, e.g. which env var or account supplies the key. */
  detail?: string
  monogram?: string
  primary: { label: string; onClick: () => void }
  secondary?: { label: string; onClick: () => void }
  footer?: JSX.Element
}

/** Featured provider card at the top of Settings → Providers (PanaAI first). */
export function ProviderSpotlight(props: ProviderSpotlightProps) {
  return (
    <section data-component="panacode-provider-spotlight" data-status={props.status}>
      <div data-slot="spotlight-head">
        <div data-slot="spotlight-glyph" aria-hidden="true">
          {props.monogram ?? props.name.slice(0, 2)}
        </div>
        <div data-slot="spotlight-copy">
          <div data-slot="spotlight-title">
            <span>{props.name}</span>
            <Show when={props.badge}>
              <span data-slot="spotlight-badge">{props.badge}</span>
            </Show>
          </div>
          <p data-slot="spotlight-description">{props.description}</p>
        </div>
      </div>
      <div data-slot="spotlight-foot">
        <div data-slot="spotlight-status">
          <span data-slot="status-dot" aria-hidden="true" />
          <span data-slot="status-label">{props.statusLabel}</span>
          <Show when={props.detail}>
            <span data-slot="status-detail">{props.detail}</span>
          </Show>
        </div>
        <div data-slot="spotlight-actions">
          <Show when={props.secondary}>
            {(secondary) => (
              <button type="button" data-slot="spotlight-secondary" onClick={() => secondary().onClick()}>
                {secondary().label}
              </button>
            )}
          </Show>
          <button type="button" data-slot="spotlight-primary" onClick={() => props.primary.onClick()}>
            {props.primary.label}
          </button>
        </div>
      </div>
      <Show when={props.footer}>
        <div data-slot="spotlight-extra">{props.footer}</div>
      </Show>
    </section>
  )
}
