export { motionTokens } from "./tokens"
export { criticalOmega, settled, stepSpring, type Spring } from "./spring"
export { prefersReducedMotion } from "./reduced"

/** Arc switch thumb. Keep in sync with switch.css (42px track, 3px padding, 18px thumb). */
export const switchMotion = {
  size: 18,
  travel: 18,
  stretch: 5,
  /** Critically damped glide. The thumb does not overshoot the reported state. */
  glide: { visualDuration: 0.3, bounce: 0 },
  /** Width change while the thumb is pressed. */
  snappy: { visualDuration: 0.26, bounce: 0 },
  /** scaleX 1 → 1.16 → 1 when the value changes without a press already stretching the thumb. */
  bounceScale: 1.16,
  bounceMs: 340,
  /** A press that just released should not add a second stretch on top of the glide. */
  pressReleaseMs: 250,
} as const
