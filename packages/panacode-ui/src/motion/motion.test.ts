import { describe, expect, test } from "bun:test"
import { springEasing } from "./arc"
import { motionTokens } from "./tokens"

describe("arc motion", () => {
  test("spring presets settle close to their visual duration without overshoot", () => {
    for (const preset of ["snappy", "smooth", "morph"] as const) {
      const { easing, duration } = springEasing(preset)
      expect(easing.startsWith("linear(0,")).toBe(true)
      expect(easing.endsWith(", 1)")).toBe(true)
      const values = easing.slice(7, -1).split(", ").map(Number)
      expect(Math.max(...values)).toBeLessThanOrEqual(1.0001)
      expect(duration).toBeGreaterThan(motionTokens.spring[preset].visualDuration * 1000 * 0.6)
      expect(duration).toBeLessThan(2000)
    }
  })
})
