import { createMemo, createSignal, For, Show } from "solid-js"
import type { ToolCallLabels, ToolCallValue } from "./index"

type Props = { value: ToolCallValue; labels: ToolCallLabels }
const page = 50

function isBranch(value: ToolCallValue): value is ToolCallValue[] | Record<string, ToolCallValue> {
  return value !== null && typeof value === "object"
}

function entries(value: ToolCallValue): [string, ToolCallValue][] {
  return isBranch(value) ? Object.entries(value) : []
}

function Node(props: Props & { name?: string; initial?: boolean }) {
  const [open, setOpen] = createSignal(props.initial ?? false)
  const [count, setCount] = createSignal(page)
  const items = createMemo(() => entries(props.value))
  const label = () => (props.name === undefined ? "" : props.name + ": ")
  const summary = () => (Array.isArray(props.value) ? "[" + items().length + "]" : "{" + items().length + "}")
  return (
    <Show
      when={isBranch(props.value) && items().length > 0}
      fallback={
        <div class="pc-json-leaf">
          <span>{label()}</span>
          <b data-kind={props.value === null ? "null" : typeof props.value}>{JSON.stringify(props.value)}</b>
        </div>
      }
    >
      <details class="pc-json-node" open={open()} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          {label()}
          <small>{summary()}</small>
        </summary>
        <Show when={open()}>
          <div class="pc-json-children">
            <For each={items().slice(0, count())}>
              {([name, value]) => <Node value={value} labels={props.labels} name={name} />}
            </For>
            <Show when={items().length > count()}>
              <button type="button" class="pc-json-more" onClick={() => setCount((n) => n + page)}>
                {props.labels.showMore(Math.min(page, items().length - count()), "row")}
              </button>
            </Show>
          </div>
        </Show>
      </details>
    </Show>
  )
}

export function JsonTree(props: Props) {
  const [query, setQuery] = createSignal("")
  const [count, setCount] = createSignal(page)
  const results = createMemo(() => {
    const term = query().trim().toLowerCase()
    if (!term) return []
    const found: { path: string; value: ToolCallValue }[] = []
    const pending = [{ path: "$", key: "", value: props.value }]
    while (pending.length) {
      const current = pending.pop()!
      if (
        current.key.toLowerCase().includes(term) ||
        (!isBranch(current.value) && String(current.value).toLowerCase().includes(term))
      )
        found.push(current)
      for (const [key, value] of entries(current.value).reverse()) {
        const part = Array.isArray(current.value) ? "[" + key + "]" : "." + key
        pending.push({ key, path: current.path + part, value })
      }
    }
    return found
  })
  return (
    <div class="pc-json-tree pc-tc-mono">
      <Show when={isBranch(props.value) && entries(props.value).length}>
        <input
          type="search"
          aria-label={props.labels.filterJson}
          placeholder={props.labels.filterJson}
          value={query()}
          onInput={(event) => {
            setQuery(event.currentTarget.value)
            setCount(page)
          }}
        />
      </Show>
      <div class="pc-json-viewport">
        <Show when={query().trim()} fallback={<Node value={props.value} initial labels={props.labels} />}>
          <For each={results().slice(0, count())} fallback={<span role="status">{props.labels.noJsonResults}</span>}>
            {(item) => <Node value={item.value} name={item.path} labels={props.labels} />}
          </For>
          <Show when={results().length > count()}>
            <button class="pc-json-more" type="button" onClick={() => setCount((n) => n + page)}>
              {props.labels.showMore(Math.min(page, results().length - count()), "row")}
            </button>
          </Show>
        </Show>
      </div>
    </div>
  )
}
