import { createMemo, createSignal, For, Show } from "solid-js"

type Segment = { label: string; value: number }

const cells = Array.from({ length: 200 }, (_, i) => i)

export function ContextWindow(props: {
  title: string
  model: string
  total: number
  limit?: number
  summary: string
  breakdown: string
  segments: Segment[]
  number: (value: number) => string
}) {
  const [hidden, setHidden] = createSignal<readonly number[]>([])
  const [active, setActive] = createSignal<number>()

  const ends = createMemo(() => {
    const capacity = Math.max(props.limit ?? 0, props.total, 1)
    let count = 0

    return props.segments.map((part) => Math.round(((count += part.value) / capacity) * cells.length))
  })

  const visible = createMemo(() =>
    props.segments.reduce((sum, part, i) => sum + (hidden().includes(i) ? 0 : part.value), 0),
  )

  const toggle = (i: number) => setHidden((old) => (old.includes(i) ? old.filter((n) => n !== i) : [...old, i]))

  return (
    <section class="context-window" aria-label={props.title}>
      <header>
        <h3>{props.title}</h3>
        <span>{props.model}</span>
      </header>
      <strong class="context-window-count">{props.summary}</strong>
      <Show when={props.limit && props.limit > 0}>
        <div class="context-cells" role="img" aria-label={props.summary}>
          <For each={cells}>
            {(cell) => {
              const group = () => ends().findIndex((end) => cell < end)

              return (
                <i aria-hidden="true" data-tone={group()} data-dim={active() !== undefined && active() !== group()} />
              )
            }}
          </For>
        </div>
      </Show>
      <div class="context-shares" role="img" aria-label={props.breakdown}>
        <For each={props.segments}>
          {(part, index) => (
            <Show when={part.value > 0 && !hidden().includes(index())}>
              <span
                data-tone={index()}
                data-dim={active() !== undefined && active() !== index()}
                title={part.label + " · " + props.number(part.value)}
                style={{ "flex-grow": part.value / Math.max(1, visible()) }}
                onPointerEnter={() => setActive(index())}
                onPointerLeave={() => setActive(undefined)}
              />
            </Show>
          )}
        </For>
      </div>
      <div class="context-legend" role="group" aria-label={props.breakdown}>
        <For each={props.segments}>
          {(part, index) => (
            <button
              type="button"
              aria-pressed={!hidden().includes(index())}
              onClick={() => toggle(index())}
              onFocus={() => setActive(index())}
              onBlur={() => setActive(undefined)}
              onPointerEnter={() => setActive(index())}
              onPointerLeave={() => setActive(undefined)}
            >
              <i data-tone={index()} aria-hidden="true" />
              <span>{part.label}</span>
              <b>{props.number(part.value)}</b>
            </button>
          )}
        </For>
      </div>
    </section>
  )
}
