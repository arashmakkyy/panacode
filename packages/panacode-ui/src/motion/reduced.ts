import { createSignal, onCleanup, onMount } from "solid-js"

/** Live `prefers-reduced-motion` flag. The switch skips the glide and the press stretch when it is set. */
export function prefersReducedMotion() {
  const query = () =>
    typeof globalThis.matchMedia === "function" ? globalThis.matchMedia("(prefers-reduced-motion: reduce)") : undefined
  const [reduced, setReduced] = createSignal(query()?.matches ?? false)

  onMount(() => {
    const media = query()

    if (!media) return
    const sync = () => setReduced(media.matches)
    sync()
    media.addEventListener("change", sync)
    onCleanup(() => media.removeEventListener("change", sync))
  })

  return reduced
}
