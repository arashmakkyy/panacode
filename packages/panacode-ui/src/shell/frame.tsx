import { splitProps, type ComponentProps, type JSX } from "solid-js"
import { Button } from "../primitives/button"
import { Skeleton } from "../primitives/feedback"
import "./shell.css"

function shellClass(local: { class?: string; classList?: Record<string, boolean | undefined> }, name: string) {
  return {
    [name]: true,
    ...local.classList,
    [local.class ?? ""]: !!local.class,
  }
}

/** Window surface. Replaces the upstream root background classes at the one layout mount. */
export function WindowFrame(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])

  return (
    <div
      {...rest}
      data-panacode-shell="window"
      data-component="panacode-window"
      classList={shellClass(local, "panacode-window")}
    >
      {local.children}
    </div>
  )
}

/** Titlebar chrome. Children stay the upstream history, tabs, and menus. */
export function TitlebarFrame(props: ComponentProps<"header">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])

  return (
    <header
      {...rest}
      data-panacode-shell="titlebar"
      data-component="panacode-titlebar"
      classList={shellClass(local, "panacode-titlebar")}
    >
      {local.children}
    </header>
  )
}

/** Sidebar column. Width, peek, and resize stay on the upstream aside. */
export function SidebarFrame(props: ComponentProps<"aside">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])

  return (
    <aside
      {...rest}
      data-panacode-shell="sidebar"
      data-component="panacode-sidebar"
      classList={shellClass(local, "panacode-sidebar")}
    >
      {local.children}
    </aside>
  )
}

/** Home / session-list panel. */
export function HomeFrame(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])

  return (
    <div {...rest} data-panacode-shell="home" data-component="panacode-home" classList={shellClass(local, "panacode-home")}>
      {local.children}
    </div>
  )
}

export function EmptyState(props: {
  title: JSX.Element
  description?: JSX.Element
  action?: { label: string; onClick: () => void; "data-action"?: string }
}) {
  return (
    <div data-panacode-shell="empty" data-component="panacode-empty" role="status">
      <p data-slot="empty-title">{props.title}</p>
      {props.description ? <p data-slot="empty-description">{props.description}</p> : null}
      {props.action ? (
        <Button variant="primary" size="sm" data-action={props.action["data-action"]} onClick={props.action.onClick}>
          {props.action.label}
        </Button>
      ) : null}
    </div>
  )
}

export function LoadingState(props: { label: string }) {
  return (
    <div data-panacode-shell="loading" data-component="panacode-loading" role="status" aria-label={props.label}>
      <Skeleton width="28%" />
      <Skeleton width="62%" />
      <Skeleton width="44%" />
      <Skeleton width="53%" />
    </div>
  )
}

export function ErrorState(props: {
  title: JSX.Element
  description?: JSX.Element
  role?: "alert" | "status"
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div data-panacode-shell="error" data-component="panacode-error" role={props.role ?? "alert"}>
      <p data-slot="empty-title">{props.title}</p>
      {props.description ? <p data-slot="empty-description">{props.description}</p> : null}
      {props.action ? (
        <Button variant="secondary" size="sm" onClick={props.action.onClick}>
          {props.action.label}
        </Button>
      ) : null}
    </div>
  )
}
