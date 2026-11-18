import { useEffect, type ReactNode } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type AnimationPlaybackControls,
} from "motion/react";
import { cx, motionTokens } from "./motion-tokens";
import "./ui.css";

type TextShimmerProps = {
  children: ReactNode;
  /** While true a calm light keeps crossing the words. */
  active?: boolean;
  /** Seconds for one pass. */
  duration?: number;
  className?: string;
};

/** Offset (in band widths) and highlight strength of each gradient stop. */
const BAND: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [-0.5, 0.5],
  [-0.2, 0.9],
  [0, 1],
  [0.2, 0.9],
  [0.5, 0.5],
  [1, 0],
];
const BAND_EM = 2.2;

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export function TextShimmer({ children, active = true, duration = 1.8, className }: TextShimmerProps) {
  const reduced = useReducedMotion() ?? false;
  const sweep = useMotionValue(0);
  const settle = useMotionValue(active ? 0 : 1);

  const backgroundImage = useTransform(() => {
    const progress = sweep.get();
    const base = `color-mix(in oklab, var(--ts-highlight) ${percent(settle.get())}, var(--ts-base))`;
    const stops = BAND.map(
      ([offset, strength]) =>
        `color-mix(in oklab, var(--ts-highlight) ${percent(strength)}, ${base}) calc(${(
          progress * 100
        ).toFixed(2)}% + ${((2 * progress - 1 + offset) * BAND_EM).toFixed(3)}em)`,
    );
    return `linear-gradient(90deg, ${base}, ${stops.join(", ")}, ${base})`;
  });

  // One linear pass, a short rest, then the next pass.
  useEffect(() => {
    if (reduced) sweep.jump(0);
    if (!active || reduced) return;
    let controls: AnimationPlaybackControls | undefined;
    let cancelled = false;
    const pass = (delay: number) => {
      if (sweep.get() >= 1) sweep.jump(0);
      controls = animate(sweep, 1, {
        duration: duration * (1 - sweep.get()),
        delay,
        ease: "linear",
        onComplete: () => {
          if (!cancelled) pass(duration * 0.32);
        },
      });
    };
    pass(sweep.get() > 0 ? 0 : 0.12);
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [active, reduced, duration, sweep]);

  // Settle the words to full strength when the work ends.
  useEffect(() => {
    const controls = animate(settle, active ? 0 : 1, {
      duration: reduced ? 0 : active ? motionTokens.duration.standard : 0.36,
      ease: motionTokens.ease.standard,
    });
    return () => controls.stop();
  }, [active, reduced, settle]);

  return (
    <span
      className={cx("arc-shimmer", className)}
      data-state={active ? "active" : "idle"}
      aria-busy={active || undefined}
    >
      <span className="arc-shimmer-stage">
        <motion.span className="arc-shimmer-label" style={{ backgroundImage }}>
          {children}
        </motion.span>
      </span>
    </span>
  );
}
