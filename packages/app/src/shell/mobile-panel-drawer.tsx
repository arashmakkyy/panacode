import { createEffect, createSignal, For, on, Show, type JSX, type ParentProps } from "solid-js"
import { Button } from "@opencode/ui/button"
import { DrawerContext } from "@opencode/plugin/gui/host"
import { useLanguage } from "@/runtime/i18n/language"
import { MobileDrawer, MobileDrawerClose, MobileDrawerContent, MobileDrawerLabel } from "./mobile-drawer"
import "./mobile-panel-drawer.css"

type DrawerView = { title: string; content: JSX.Element; trigger: HTMLElement }

export function MobilePanelDrawer(
  props: ParentProps<{
    title: string
    hideHeader?: boolean
    open: boolean
    onOpenChange: (open: boolean) => void
    onContentPresentChange?: (present: boolean) => void
    initialFocus?: () => HTMLElement | undefined
    returnFocus?: () => HTMLElement | undefined
    onFinalFocus?: (event: Event) => void
  }>,
) {
  const language = useLanguage()
  const [views, setViews] = createSignal<DrawerView[]>([])
  const current = () => views().at(-1)
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (open) setViews([])
      },
    ),
  )

  let panel: HTMLDivElement | undefined

  const navigation = {
    close: () => props.onOpenChange(false),
    open: (view: DrawerView) => {
      setViews((previous) => [...previous, view])
      queueMicrotask(() => panel?.querySelector<HTMLButtonElement>('[data-panel-current="true"] [data-action="drawer-back"]')?.focus())
    },
    back: () => {
      const trigger = current()?.trigger
      setViews((previous) => previous.slice(0, -1))
      queueMicrotask(() => { if (trigger?.isConnected) trigger.focus() })
    },
  }

  return (
    <DrawerContext.Provider value={navigation}>
      <MobileDrawer
        open={props.open}
        onOpenChange={props.onOpenChange}
        onContentPresentChange={props.onContentPresentChange}
        initialFocus={props.initialFocus}
        returnFocus={props.returnFocus}
        onFinalFocus={props.onFinalFocus}
        // Menu focus handoff must not dismiss the drawer during its opening transition.
        closeOnOutsideFocus={false}
      >
        <MobileDrawerContent>
          <div ref={panel} data-slot="mobile-panel" data-depth={views().length} data-corvu-no-drag
            onKeyDown={(event) => {
              if (event.defaultPrevented || event.key !== "Escape" || !current()) return
              event.preventDefault()
              event.stopPropagation()
              navigation.back()
            }}>
            <Show
              when={!props.hideHeader}
              fallback={<MobileDrawerLabel class="sr-only">{current()?.title ?? props.title}</MobileDrawerLabel>}
            >
              <div data-slot="mobile-panel-header">
                <MobileDrawerLabel>{current()?.title ?? props.title}</MobileDrawerLabel>
                <MobileDrawerClose
                  as={Button}
                  variant="ghost"
                  data-slot="mobile-panel-close"
                  aria-label={language.t("common.close")}
                >
                  {language.t("common.close")}
                </MobileDrawerClose>
              </div>
            </Show>
            <div data-slot="mobile-panel-content">
              <div hidden={!!current()}>{props.children}</div>
              <For each={views()}>{(view, i) => (
                <div hidden={i() !== views().length - 1} data-panel-current={i() === views().length - 1}>
                  <Button variant="ghost" icon="arrow-left" data-action="drawer-back"
                    class="mb-2 !justify-start" aria-label={language.t("common.goBack")} onClick={navigation.back}>
                    {views()[i() - 1]?.title ?? props.title}
                  </Button>
                  {view.content}
                </div>
              )}</For>
            </div>
          </div>
        </MobileDrawerContent>
      </MobileDrawer>
    </DrawerContext.Provider>
  )
}
