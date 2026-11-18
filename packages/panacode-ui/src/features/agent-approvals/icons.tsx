import { For, type JSX } from "solid-js"

/** Lucide glyphs used by the Arc agent-approvals block (24px grid, 1.75 stroke). */
const PATHS = {
  shield: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18 M6 6l12 12",
  chevron: "m9 18 6-6-6-6",
  wrench:
    "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
  terminal: "m4 17 6-6-6-6 M12 19h8",
  edit: "M12 20h9 M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z",
  search: "M21 21l-4.34-4.34 M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  globe: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20 M2 12h20",
  folder: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
  alert: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 8v4 M12 16h.01",
  checkCheck: "M18 6 7 17l-5-5 m22 10-7.5 7.5L13 16",
} as const

const EXTRA = {
  shieldCheck: "m9 12 2 2 4-4",
  shieldAlert: "M12 8v4 M12 16h.01",
  shieldX: "m14.5 9.5-5 5 m-0-5 5 5",
} as const

export type ApprovalIconName = keyof typeof PATHS | keyof typeof EXTRA

export function ApprovalIcon(props: { name: ApprovalIconName; size?: number; class?: string } & JSX.SvgSVGAttributes<SVGSVGElement>) {
  const paths = () => {
    if (props.name === "shieldCheck" || props.name === "shieldAlert" || props.name === "shieldX")
      return [PATHS.shield, props.name === "shieldX" ? "m14.5 9.5-5 5 M9.5 9.5l5 5" : EXTRA[props.name]]
    return [PATHS[props.name as keyof typeof PATHS]]
  }
  return (
    <svg
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={props.class}
      data-icon={props.name}
    >
      <For each={paths()}>{(d) => <path d={d} />}</For>
    </svg>
  )
}
