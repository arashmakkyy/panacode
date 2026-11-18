import { describe, expect, test } from "bun:test"
import { criticalOmega, settled, stepSpring } from "./spring"

describe("critical spring", () => {
  test("reaches the target without crossing it", () => {
    const omega = criticalOmega(0.3)
    let spring = { x: 0, v: 0, target: 18 }
    let peak = 0

    for (let i = 0; i < 90; i++) {
      spring = stepSpring(spring, omega, 1 / 60)
      peak = Math.max(peak, spring.x)
    }

    expect(peak).toBeLessThanOrEqual(18.05)
    expect(settled(spring)).toBe(true)
    expect(spring.x).toBeGreaterThan(17.9)
  })

  test("holds a target it has already reached", () => {
    const next = stepSpring({ x: 18, v: 0, target: 18 }, criticalOmega(0.3), 1 / 60)

    expect(next.x).toBeCloseTo(18)
    expect(next.v).toBeCloseTo(0)
  })
})
