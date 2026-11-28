import { createUniqueId, splitProps, type ComponentProps } from "solid-js"
import { pack as meta } from "./brand"
import iconImage from "./assets/icon-256.png"
import { MARK_PATH, MARK_VIEWBOX, WORDMARK_PATH, WORDMARK_VIEWBOX } from "./geometry"

export const brand = {
  id: meta.id,
  name: meta.name,
  direction: meta.direction,
  tagline: meta.tagline,
  publisher: meta.publisher,
} as const

/** App icon (256px raster of assets/icon-1024.png) for in-app use such as About. */
export const brandIcon = iconImage

type SvgProps = Omit<ComponentProps<"svg">, "children">

/** The Panacode mark. `tone="color"` paints the brand gradient (it follows the colour scheme), `mono` uses currentColor. */
export function BrandMark(props: SvgProps & { size?: number | string; tone?: "color" | "mono" }) {
  const [local, rest] = splitProps(props, ["size", "tone"])
  const id = `pc-mark-${createUniqueId()}`
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      width={local.size ?? 24}
      height={local.size ?? 24}
      aria-hidden={rest["aria-label"] ? undefined : "true"}
      data-component="brand-mark"
      {...rest}
    >
      {local.tone !== "mono" && (
        <defs>
          <linearGradient id={id} x1="12" y1="4" x2="50" y2="60" gradientUnits="userSpaceOnUse">
            <stop offset="0" style={{ "stop-color": "var(--brand-mark-from, #8cffe6)" }} />
            <stop offset="1" style={{ "stop-color": "var(--brand-mark-to, #12c2ae)" }} />
          </linearGradient>
        </defs>
      )}
      <path fill-rule="evenodd" fill={local.tone === "mono" ? "currentColor" : `url(#${id})`} d={MARK_PATH} />
    </svg>
  )
}

/** The outlined wordmark. Height drives size; it always uses currentColor. */
export function BrandWordmark(props: SvgProps & { height?: number | string }) {
  const [local, rest] = splitProps(props, ["height"])
  return (
    <svg
      viewBox={WORDMARK_VIEWBOX}
      height={local.height ?? 18}
      fill="currentColor"
      role="img"
      aria-label={brand.name}
      data-component="brand-wordmark"
      {...rest}
    >
      <path d={WORDMARK_PATH} />
    </svg>
  )
}

/** Mark + wordmark, the horizontal lockup used in the sidebar, About and splash. */
export function BrandLockup(props: { size?: number; class?: string; tone?: "color" | "mono" }) {
  const size = () => props.size ?? 22
  return (
    <span
      data-component="brand-lockup"
      class={props.class}
      style={{ display: "inline-flex", "align-items": "center", gap: `${Math.round(size() * 0.38)}px` }}
    >
      <BrandMark size={size()} tone={props.tone} />
      <BrandWordmark height={Math.round(size() * 0.78)} style={{ "margin-top": `${Math.round(size() * 0.1)}px` }} />
    </span>
  )
}

