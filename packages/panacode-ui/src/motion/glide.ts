/**
 * Arc's shared highlight: one element glides to whichever row is active instead of each row painting its own
 * background (command palette, dropdown and context menus, select lists). Works on lists the host already renders:
 * it watches `active` (an attribute such as data-active or data-highlighted) inside `root` and moves a single
 * absolutely positioned element there. The host keeps its own row backgrounds off with CSS.
 */
export function glideHighlight(root: HTMLElement, options: { active: string; class?: string; within?: string }) {
  // The list may render after the host mounts, so wait for it.
  const find = () => (options.within ? root.querySelector<HTMLElement>(options.within) : root)
  const found = find()
  if (found) return attach(found, options)
  let stop: (() => void) | undefined
  const watcher = new MutationObserver(() => {
    const layer = find()
    if (!layer) return
    watcher.disconnect()
    stop = attach(layer, options)
  })
  watcher.observe(root, { childList: true, subtree: true })
  return () => {
    watcher.disconnect()
    stop?.()
  }
}

function attach(layer: HTMLElement, options: { active: string; class?: string }) {
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  const box = document.createElement("div")
  box.className = options.class ?? "pc-glide"
  box.setAttribute("aria-hidden", "true")
  box.style.opacity = "0"
  if (getComputedStyle(layer).position === "static") layer.style.position = "relative"
  layer.prepend(box)
  let shown = false
  let frame = 0

  const place = () => {
    frame = 0
    const row = layer.querySelector<HTMLElement>(`[${options.active}]`)
    if (!row || !row.offsetParent) {
      box.style.opacity = "0"
      shown = false
      return
    }
    const base = layer.getBoundingClientRect()
    const rect = row.getBoundingClientRect()
    const top = rect.top - base.top + layer.scrollTop
    const left = rect.left - base.left + layer.scrollLeft
    // The first placement jumps; later ones glide (unless reduced motion asks otherwise).
    box.style.transition = shown && !reduced ? "" : "none"
    box.style.transform = `translate(${left}px, ${top}px)`
    box.style.width = `${rect.width}px`
    box.style.height = `${rect.height}px`
    box.style.opacity = "1"
    if (!shown) void box.offsetWidth
    shown = true
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(place)
  }

  const observer = new MutationObserver(schedule)
  observer.observe(layer, { attributes: true, attributeFilter: [options.active], subtree: true, childList: true })
  const resize = new ResizeObserver(schedule)
  resize.observe(layer)
  schedule()

  return () => {
    observer.disconnect()
    resize.disconnect()
    if (frame) cancelAnimationFrame(frame)
    box.remove()
  }
}

const MENU_SURFACES = '[data-component="menu-v2-content"], [data-component="context-menu-content"], [data-component="context-menu-sub-content"]'

/**
 * Gives every dropdown and context menu the gliding highlight. Menus portal into `root` (the body) when they open,
 * so this watches for their surfaces and attaches to each one, and lets go when the menu closes.
 */
export function menuGlide(root: HTMLElement = document.body) {
  const live = new Map<HTMLElement, () => void>()
  const scan = (node: Node) => {
    if (!(node instanceof HTMLElement)) return
    const found = node.matches(MENU_SURFACES) ? [node] : [...node.querySelectorAll<HTMLElement>(MENU_SURFACES)]
    for (const menu of found) {
      if (live.has(menu)) continue
      live.set(menu, attach(menu, { active: "data-highlighted", class: "pc-menu-glide" }))
    }
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(scan)
    for (const [menu, stop] of live) {
      if (menu.isConnected) continue
      stop()
      live.delete(menu)
    }
  })
  observer.observe(root, { childList: true, subtree: true })
  scan(root)
  return () => {
    observer.disconnect()
    for (const stop of live.values()) stop()
    live.clear()
  }
}
