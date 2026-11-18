import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { T } from "./motion";
import styles from "./text-shimmer.module.css";

/* Weighted stops of the highlight band: [offset in band widths, highlight weight]. */
const BAND: Array<[number, number]> = [
  [-1, 0],
  [-0.5, 0.5],
  [-0.2, 0.9],
  [0, 1],
  [0.2, 0.9],
  [0.5, 0.5],
  [1, 0],
];
const pct = (n: number) => `${(100 * n).toFixed(1)}%`;

function usePageVisible() {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/**
 * A calm shimmer for live status text. While active a soft highlight band sweeps
 * across the text; when it stops the sweep finishes and the text settles solid.
 */
export function TextShimmer({
  children,
  active = true,
  duration = 1.8,
  as: Tag = "span",
  className,
  id,
}: {
  children: ReactNode;
  active?: boolean;
  duration?: number;
  as?: ElementType;
  className?: string;
  id?: string;
}) {
  const stageRef = useRef<HTMLSpanElement>(null);
  const reduced = !!useReducedMotion();
  const inView = useInView(stageRef, { margin: "64px" });
  const visible = usePageVisible();
  const progress = useMotionValue(0);
  const settle = useMotionValue(active ? 0 : 1);

  const backgroundImage = useTransform(() => {
    const p = progress.get();
    const s = settle.get();
    const base = `color-mix(in oklab, var(--ts-highlight) ${pct(s)}, var(--ts-base))`;
    const stops = BAND.map(
      ([offset, weight]) =>
        `color-mix(in oklab, var(--ts-highlight) ${pct(weight)}, ${base}) calc(${(100 * p).toFixed(2)}% + ${((2 * p - 1 + offset) * 2.2).toFixed(3)}em)`,
    );
    return `linear-gradient(90deg, ${base}, ${stops.join(", ")}, ${base})`;
  });

  const running = active && !reduced && inView && visible;

  useEffect(() => {
    if (reduced) progress.jump(0);
    if (!running) return;
    let controls: ReturnType<typeof animate> | undefined;
    const sweep = (delay: number) => {
      if (progress.get() >= 1) progress.jump(0);
      controls = animate(progress, 1, {
        duration: duration * (1 - progress.get()),
        delay,
        ease: "linear",
        onComplete: () => sweep(0.32 * duration),
      });
    };
    sweep(progress.get() > 0 ? 0 : 0.12);
    return () => controls?.stop();
  }, [running, reduced, duration, progress]);

  useEffect(() => {
    if (active) {
      const fade = animate(settle, 0, { duration: reduced ? 0 : T.duration.standard, ease: T.ease.standard });
      return () => fade.stop();
    }
    const p = progress.get();
    const finish =
      !reduced && p > 0 && p < 1
        ? animate(progress, 1, { duration: Math.min(0.42, duration * (1 - p) * 0.5), ease: T.ease.enter })
        : undefined;
    const solid = animate(settle, 1, { duration: reduced ? T.duration.instant : 0.36, ease: T.ease.standard });
    return () => {
      finish?.stop();
      solid.stop();
    };
  }, [active, reduced, duration, progress, settle]);

  const textKey = typeof children === "string" ? children : "label";

  return (
    <Tag
      id={id}
      className={[styles.shimmer, className].filter(Boolean).join(" ")}
      data-state={active ? "active" : "idle"}
      aria-busy={active || undefined}
    >
      <span ref={stageRef} className={styles.stage}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={textKey}
            className={styles.label}
            style={{ backgroundImage }}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: "0.3em", filter: `blur(${T.blur.soft}px)` }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: "0em", filter: "blur(0px)" }}
            exit={
              reduced
                ? { opacity: 0, transition: { duration: T.duration.instant } }
                : {
                    opacity: 0,
                    y: "-0.24em",
                    filter: `blur(${T.blur.subtle}px)`,
                    transition: { duration: T.duration.fast, ease: T.ease.standard },
                  }
            }
            transition={{ duration: reduced ? T.duration.instant : T.duration.standard, ease: T.ease.enter }}
          >
            {children}
          </motion.span>
        </AnimatePresence>
      </span>
    </Tag>
  );
}
