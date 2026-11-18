/**
 * Critically damped spring used by the Arc switch (visualDuration, bounce 0).
 * The thumb lands on the state it reports and does not overshoot.
 */

export type Spring = {
  x: number
  v: number
  target: number
}

/** ω such that a critical spring is within ~2% of its target at `visualDuration` seconds. */
export function criticalOmega(visualDuration: number) {
  return 5.833 / Math.max(visualDuration, 0.001)
}

/** Analytic step of a critically damped spring. `dt` is seconds. */
export function stepSpring(spring: Spring, omega: number, dt: number): Spring {
  const w = omega
  const offset = spring.x - spring.target
  const amplitude = spring.v + w * offset
  const decay = Math.exp(-w * dt)
  const nextOffset = (offset + amplitude * dt) * decay
  const nextV = (amplitude - w * (offset + amplitude * dt)) * decay

  return { x: nextOffset + spring.target, v: nextV, target: spring.target }
}

export function settled(spring: Spring, epsilon = 0.04) {
  return Math.abs(spring.x - spring.target) < epsilon && Math.abs(spring.v) < epsilon
}
