/** Motion presets shared by Panacode primitives (ported from Arc MCP reference). */
export const motionTokens = {
  duration: { instant: 0.12, fast: 0.16, exit: 0.18, standard: 0.24, considered: 0.48 },
  ease: {
    enter: [0.16, 1, 0.3, 1] as const,
    exit: [0.7, 0, 0.84, 0] as const,
    standard: [0.22, 1, 0.36, 1] as const,
    inOut: [0.65, 0, 0.35, 1] as const,
  },
  spring: {
    responsive: { type: "spring" as const, stiffness: 520, damping: 44 },
    gentle: { type: "spring" as const, stiffness: 340, damping: 34 },
    /** Presses, toggles, thumbs, and small indicators. Settles fast and never overshoots. */
    snappy: { type: "spring" as const, visualDuration: 0.26, bounce: 0 },
    /** Panels, height changes, and layout shifts. Critically damped, never overshoots. */
    smooth: { type: "spring" as const, visualDuration: 0.4, bounce: 0 },
    /** Shape morphs and width changes that follow new content. No bounce. */
    morph: { type: "spring" as const, visualDuration: 0.42, bounce: 0 },
  },
  /** Stagger steps in seconds. Keep total stagger under roughly 0.4s. */
  stagger: { char: 0.016, word: 0.04, line: 0.08, item: 0.035 },
  /** Blur radii in px for text and content crossfades. Keep blur small and brief. */
  blur: { subtle: 2, soft: 4, text: 8 },
} as const
