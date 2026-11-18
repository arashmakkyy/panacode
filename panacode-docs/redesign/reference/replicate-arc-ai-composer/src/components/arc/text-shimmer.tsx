import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type AnimationPlaybackControls,
} from "motion/react";
import { cx, tokens } from "./tokens";
import "./arc.css";

/* The light: stops around the sweep position, as [offset, strength]. */
const STOPS: Array<[number, number]> = [
  [-1, 0],
  [-0.5, 0.5],
  [-0.2, 0.9],
  [0, 1],
  [0.2, 0.9],
  [0.5, 0.5],
  [1, 0],
];
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function usePageVisible() {
  const [visible, setVisible] = useState(() => (typeof document === "undefined" ? true : !document.hidden));
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

export function TextShimmer({
  children,
  active = true,
  duration = 1.8,
  className,
  id,
}: {
  children: ReactNode;
  active?: boolean;
  duration?: number;
  className?: string;
  id?: string;
}) {
  const stageRef = useRef<HTMLSpanElement>(null);
  const reduced = !!useReducedMotion();
  const inView = useInView(stageRef, { margin: "64px" });
  const pageVisible = usePageVisible();
  const sweep = useMotionValue(0);
  const settle = useMotionValue(active ? 0 : 1);

  const backgroundImage = useTransform(() => {
    const position = sweep.get();
    const base = `color-mix(in oklab, var(--ts-highlight) ${pct(settle.get())}, var(--ts-base))`;
    const stops = STOPS.map(
      ([offset, strength]) =>
        `color-mix(in oklab, var(--ts-highlight) ${pct(strength)}, ${base}) calc(${(position * 100).toFixed(2)}% + ${(
          (position * 2 - 1 + offset) *
          2.2
        ).toFixed(3)}em)`,
    );
    return `linear-gradient(90deg, ${base}, ${stops.join(", ")}, ${base})`;
  });

  const running = active && !reduced && inView && pageVisible;
  const lastWidth = useRef(0);

  useEffect(() => {
    if (reduced) sweep.jump(0);
    if (!running) return;
    let controls: AnimationPlaybackControls | undefined;
    const loop = (delay: number) => {
      if (sweep.get() >= 1) sweep.jump(0);
      controls = animate(sweep, 1, {
        duration: duration * (1 - sweep.get()),
        delay,
        ease: "linear",
        onComplete: () => loop(duration * 0.32),
      });
    };
    loop(sweep.get() > 0 ? 0 : 0.12);
    return () => controls?.stop();
  }, [running, reduced, duration, sweep]);

  useEffect(() => {
    if (active) {
      const controls = animate(settle, 0, {
        duration: reduced ? 0 : tokens.duration.standard,
        ease: tokens.ease.standard,
      });
      return () => controls.stop();
    }
    const position = sweep.get();
    const finish =
      !reduced && position > 0 && position < 1
        ? animate(sweep, 1, { duration: Math.min(0.42, duration * (1 - position) * 0.5), ease: tokens.ease.enter })
        : undefined;
    const controls = animate(settle, 1, {
      duration: reduced ? tokens.duration.instant : 0.36,
      ease: tokens.ease.standard,
    });
    return () => {
      finish?.stop();
      controls.stop();
    };
  }, [active, reduced, duration, sweep, settle]);

  /* The label springs to the width of its new text. */
  useLayoutEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const wasSizing = !!node.style.width;
    const current = node.getBoundingClientRect().width;
    node.style.width = "";
    const next = node.getBoundingClientRect().width;
    const from = wasSizing ? current : lastWidth.current;
    lastWidth.current = next;
    if (reduced || !from || Math.abs(from - next) < 0.5) {
      delete node.dataset.sizing;
      return;
    }
    node.dataset.sizing = "";
    const controls = animate(
      node,
      { width: [from, next] },
      {
        ...tokens.spring.morph,
        onComplete: () => {
          node.style.width = "";
          delete node.dataset.sizing;
        },
      },
    );
    return () => controls.stop();
  }, [children, reduced]);

  useEffect(() => {
    const node = stageRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!node.style.width) lastWidth.current = node.getBoundingClientRect().width;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const key = typeof children === "string" || typeof children === "number" ? String(children) : "label";

  return (
    <span id={id} className={cx("ts-shimmer", className)} data-state={active ? "active" : "idle"} aria-busy={active || undefined}>
      <span ref={stageRef} className="ts-stage">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={key}
            className="ts-label"
            style={{ backgroundImage }}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: "0.3em", filter: `blur(${tokens.blur.soft}px)` }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: "0em", filter: "blur(0px)" }}
            exit={
              reduced
                ? { opacity: 0, transition: { duration: tokens.duration.instant } }
                : {
                    opacity: 0,
                    y: "-0.24em",
                    filter: `blur(${tokens.blur.subtle}px)`,
                    transition: { duration: tokens.duration.fast, ease: tokens.ease.standard },
                  }
            }
            transition={{ duration: reduced ? tokens.duration.instant : tokens.duration.standard, ease: tokens.ease.enter }}
          >
            {children}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  );
}
