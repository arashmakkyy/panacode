import { type ComponentProps } from "solid-js"

/** Panacode “P” mark (replaces the upstream OpenCode “O”). */
export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-logo-mark-shadow" d="M12 14H4V8H12V14Z" fill="var(--icon-weak-base)" />
      <path
        data-slot="logo-logo-mark-p"
        d="M4 16H12V6H4V16ZM16 18H4V20H0V2H16V18Z"
        fill="var(--icon-strong-base)"
      />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M60 70H20V40H60V70Z" fill="var(--icon-base)" />
      <path d="M20 80H60V30H20V80ZM80 90H20V100H0V10H80V90Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

/** Block wordmark spelling PANACODE (same 234×42 grid as the upstream OPENCODE mark). */
export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 234 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
      data-component="panacode-logo"
      aria-label="Panacode"
    >
      <g>
        {/* P */}
        <path d="M18 30H6V18H18V30Z" fill="var(--icon-weak-base)" />
        <path d="M6 30H18V12H6V30ZM24 36H6V42H0V6H24V36Z" fill="var(--icon-base)" />
        {/* A */}
        <path d="M48 30H36V24H48V30Z" fill="var(--icon-weak-base)" />
        <path d="M30 36H36V18H48V36H54V12H48V6H36V12H30V36Z" fill="var(--icon-base)" />
        {/* N */}
        <path d="M78 36H66V18H78V36Z" fill="var(--icon-weak-base)" />
        <path d="M78 12H66V36H60V6H78V12ZM84 36H78V12H84V36Z" fill="var(--icon-base)" />
        {/* A */}
        <path d="M108 30H96V24H108V30Z" fill="var(--icon-weak-base)" />
        <path d="M90 36H96V18H108V36H114V12H108V6H96V12H90V36Z" fill="var(--icon-base)" />
        {/* C */}
        <path d="M144 30H126V18H144V30Z" fill="var(--icon-weak-base)" />
        <path d="M144 12H126V30H144V36H120V6H144V12Z" fill="var(--icon-strong-base)" />
        {/* O */}
        <path d="M168 30H156V18H168V30Z" fill="var(--icon-weak-base)" />
        <path d="M168 12H156V30H168V12ZM174 36H150V6H174V36Z" fill="var(--icon-strong-base)" />
        {/* D */}
        <path d="M198 30H186V18H198V30Z" fill="var(--icon-weak-base)" />
        <path d="M198 12H186V30H198V12ZM204 36H180V6H198V0H204V36Z" fill="var(--icon-strong-base)" />
        {/* E */}
        <path d="M234 24V30H216V24H234Z" fill="var(--icon-weak-base)" />
        <path d="M216 12V18H228V12H216ZM234 24H216V30H234V36H210V6H234V24Z" fill="var(--icon-strong-base)" />
      </g>
    </svg>
  )
}
