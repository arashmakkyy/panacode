/** Product mark used in provider rows. Panacode “P” (replaces upstream OpenCode “O”). */
export function OpenCodeLogo(props: { class?: string }) {
  return (
    <svg
      data-component="panacode-logo-mark"
      aria-hidden="true"
      class={props.class}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(1.2 1.2) scale(0.85)">
        <path opacity="0.2" d="M11.2 11.2H4.8V6.4H11.2V11.2Z" fill="currentColor" />
        <path d="M4.8 12.8H11.2V4.8H4.8V12.8ZM14.4 14.4H4.8V16H1.6V1.6H14.4V14.4Z" fill="currentColor" />
      </g>
    </svg>
  )
}
