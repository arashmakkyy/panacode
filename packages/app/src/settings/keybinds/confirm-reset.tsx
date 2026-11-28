import { createSignal, onCleanup } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"

export function ConfirmReset(props: { disabled: boolean; onReset: () => void }) {
  const language = useLanguage()
  const [armed, setArmed] = createSignal(false)
  const [holding, setHolding] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let committed = false

  const stop = () => {
    clearTimeout(timer)
    setHolding(false)
  }

  const cancel = () => {
    stop()
    setArmed(false)
  }

  const apply = () => {
    cancel()
    props.onReset()
  }

  onCleanup(() => clearTimeout(timer))

  return (
    <button
      type="button"
      class="shortcut-reset"
      data-holding={holding()}
      data-armed={armed()}
      disabled={props.disabled}
      onBlur={cancel}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return
        stop()
        committed = false
        setHolding(true)
        timer = setTimeout(() => {
          committed = true
          apply()
        }, 850)
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={cancel}
      onKeyDown={(event) => {
        if (event.key === "Escape" && armed()) {
          event.preventDefault()
          event.stopPropagation()
          cancel()
        }
      }}
      onClick={() => {
        if (committed) {
          committed = false

          return
        }

        if (armed()) apply()
        else setArmed(true)
      }}
    >
      <span>{language.t(armed() ? "panacode.shortcuts.confirmReset" : "settings.shortcuts.reset.button")}</span>
    </button>
  )
}
