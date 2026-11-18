import { Spring, frameLoop, prefersReducedMotion, observeReducedMotion } from "@opencode/ui/motion"
import { motionTokens } from "./tokens"

/**
 * Arc motion layer for Panacode (tokens: ./tokens.ts, copied from Arc `shared/arc-motion-tokens`).
 * Springs use the same (visualDuration, bounce) parameters as Arc's motion springs, integrated by the
 * upstream closed-form `Spring`, and are also published as CSS `linear()` easings so plain CSS
 * transitions follow Arc's spring timings: `transition: transform var(--spring-smooth-duration) var(--spring-smooth)`.
 */
export type SpringPreset = "snappy" | "smooth" | "morph"

/** A fresh upstream spring at `value` tuned to an Arc preset. */
export function arcSpring(preset: SpringPreset, value = 0) {
  const { visualDuration, bounce } = motionTokens.spring[preset]
  return Spring.fromDuration(value, { duration: visualDuration, bounce })
}

/** Samples a 0→1 step of the preset into a CSS `linear()` easing and the time it takes to settle. */
export function springEasing(preset: SpringPreset, points = 48) {
  const spring = arcSpring(preset, 0).set(1)
  const dt = 1 / 240
  const samples: number[] = [0]
  let t = 0
  while (t < 2 && !(spring.resting || (Math.abs(spring.value - 1) < 0.001 && Math.abs(spring.velocity) < 0.01))) {
    spring.step(dt)
    t += dt
    samples.push(spring.value)
  }
  samples[samples.length - 1] = 1
  const step = Math.max(1, Math.floor(samples.length / points))
  const picked = samples.filter((_, i) => i % step === 0)
  if (picked[picked.length - 1] !== 1) picked.push(1)
  return { easing: `linear(${picked.map((v) => +v.toFixed(4)).join(", ")})`, duration: Math.round(t * 1000) }
}

/** Publishes --spring-{snappy,smooth,morph} and their durations on the root; zero durations when motion is reduced. */
export function installMotionTokens(root: HTMLElement = document.documentElement) {
  const apply = () => {
    const reduced = prefersReducedMotion()
    for (const preset of ["snappy", "smooth", "morph"] as const) {
      const { easing, duration } = springEasing(preset)
      root.style.setProperty(`--spring-${preset}`, easing)
      root.style.setProperty(`--spring-${preset}-duration`, reduced ? "0ms" : `${duration}ms`)
    }
  }
  apply()
  return observeReducedMotion(apply)
}

/**
 * Springs a numeric style or property toward `to` on the shared frame loop.
 * Returns a stop function. Reduced motion snaps to the target.
 */
export function springTo(
  from: number,
  to: number,
  preset: SpringPreset,
  write: (value: number) => void,
  done?: () => void,
) {
  if (prefersReducedMotion()) {
    write(to)
    done?.()
    return () => {}
  }
  const spring = arcSpring(preset, from).set(to)
  return frameLoop.add((dt) => {
    write(spring.step(dt))
    if (!spring.resting) return true
    write(to)
    done?.()
    return false
  })
}

if (typeof document !== "undefined") installMotionTokens()
