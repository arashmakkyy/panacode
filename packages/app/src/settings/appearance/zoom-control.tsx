import { createEffect, createSignal } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import type { AppearanceSettingsController } from "@/settings/general/controllers"

export function ZoomControl(props: { zoom: AppearanceSettingsController["zoom"] }) {
  const language = useLanguage()
  const levels = props.zoom.options
  const [percent, setPercent] = createSignal("")
  const selected = () => Math.max(0, levels.indexOf(props.zoom.current()))
  createEffect(() => setPercent(String(Math.round(props.zoom.current() * 100))))

  const commit = () => {
    const value = Number(percent()) / 100

    if (percent().trim() && Number.isFinite(value) && value > 0) {
      const nearest = levels.reduce((a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a))
      props.zoom.select(nearest)
      setPercent(String(Math.round(nearest * 100)))
    } else {
      setPercent(String(Math.round(props.zoom.current() * 100)))
    }
  }

  return (
    <div class="zoom-control" data-action="settings-zoom">
      <input
        type="range"
        min={0}
        max={levels.length - 1}
        value={selected()}
        aria-valuetext={props.zoom.label(props.zoom.current())}
        aria-label={language.t("settings.appearance.row.zoom.title")}
        onInput={(event) => props.zoom.select(levels[event.currentTarget.valueAsNumber])}
      />
      <label>
        <input
          type="number"
          min={Math.round(levels[0] * 100)}
          max={Math.round(levels[levels.length - 1] * 100)}
          aria-label={language.t("panacode.zoom.percent")}
          value={percent()}
          onInput={(event) => setPercent(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur()
          }}
        />
        <span aria-hidden="true">%</span>
      </label>
    </div>
  )
}
