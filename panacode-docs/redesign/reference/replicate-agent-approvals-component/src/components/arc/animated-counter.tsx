import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "motion/react";
import { T } from "./motion";
import styles from "./animated-counter.module.css";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const revealSpring = { ...T.spring.smooth, visualDuration: T.duration.considered };
const columnPresence = {
  initial: { width: 0, opacity: 0 },
  animate: { width: "auto", opacity: 1 },
  exit: { width: 0, opacity: 0 },
};

function Glyph({ position, digit }: { position: MotionValue<number>; digit: number }) {
  const offset = useTransform(position, (p) => ((((digit - p) % 10) + 15) % 10) - 5);
  const y = useTransform(offset, (o) => `${o}em`);
  const opacity = useTransform(offset, (o) => Math.max(0, 1 - Math.abs(o)));
  const visibility = useTransform(offset, (o) => (Math.abs(o) >= 1 ? "hidden" : "visible"));
  const filter = useTransform(offset, (o) =>
    Math.abs(o) < 0.02 || Math.abs(o) >= 1 ? "none" : `blur(${(Math.abs(o) * T.blur.subtle).toFixed(2)}px)`,
  );
  return (
    <motion.span className={styles.glyph} style={{ y, opacity, filter, visibility }}>
      {digit}
    </motion.span>
  );
}

function DigitColumn({
  digit,
  direction,
  armed,
  delay,
  reduceMotion,
}: {
  digit: number;
  direction: number;
  armed: boolean;
  delay: number;
  reduceMotion: boolean;
}) {
  const position = useMotionValue(armed ? 0 : digit);
  const state = useRef({ digit: armed ? 0 : digit, target: armed ? 0 : digit, revealed: !armed });

  useEffect(() => {
    const current = state.current;
    if (armed || current.digit === digit) {
      if (!armed) current.revealed = true;
      return;
    }
    current.target +=
      direction < 0 && current.revealed ? -((current.digit - digit + 10) % 10) : (digit - current.digit + 10) % 10;
    current.digit = digit;
    if (reduceMotion) position.jump(current.target);
    else animate(position, current.target, current.revealed ? T.spring.smooth : { ...revealSpring, delay });
    current.revealed = true;
  }, [armed, delay, digit, direction, position, reduceMotion]);

  return (
    <motion.span className={styles.column} {...columnPresence} transition={reduceMotion ? { duration: 0 } : T.spring.morph}>
      <span className={styles.sizer}>0</span>
      {DIGITS.map((d) => (
        <Glyph key={d} position={position} digit={d} />
      ))}
    </motion.span>
  );
}

type Part = { key: string; digit: number; order: number } | { key: string; text: string };

export function AnimatedCounter({
  value,
  label,
  prefix = "",
  suffix = "",
  decimals = 0,
  animateOnView = false,
  locale = "en-US",
}: {
  value: number;
  label?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  animateOnView?: boolean;
  locale?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduced = !!useReducedMotion();
  const [previous, setPrevious] = useState(value);
  const [direction, setDirection] = useState(1);
  if (value !== previous) {
    setPrevious(value);
    setDirection(value > previous ? 1 : -1);
  }

  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    numberingSystem: "latn",
  }).formatToParts(value);
  let integerLeft = formatted.reduce((sum, part) => sum + (part.type === "integer" ? part.value.length : 0), 0);
  let fraction = 0;
  let order = 0;
  const parts: Part[] = formatted.flatMap((part, index): Part[] => {
    if (part.type === "integer") return [...part.value].map((d) => ({ key: `i${--integerLeft}`, digit: Number(d), order: order++ }));
    if (part.type === "fraction") return [...part.value].map((d) => ({ key: `f${fraction++}`, digit: Number(d), order: order++ }));
    return [
      {
        key: part.type === "group" ? `g${integerLeft}` : part.type === "decimal" ? "d" : `${part.type}${index}`,
        text: part.value,
      },
    ];
  });
  const readable = `${prefix}${parts.map((p) => ("text" in p ? p.text : p.digit)).join("")}${suffix}`;
  const armed = animateOnView && !inView;

  return (
    <span ref={ref} className={styles.counter}>
      {label && <span className={styles.label}>{label}</span>}
      <span className={styles.srOnly}>{readable}</span>
      <span className={styles.value} aria-hidden="true">
        {prefix && <span className={styles.symbol}>{prefix}</span>}
        <AnimatePresence initial={false}>
          {parts.map((part) =>
            "digit" in part ? (
              <DigitColumn
                key={part.key}
                digit={part.digit}
                direction={direction}
                armed={armed}
                delay={Math.min(part.order * T.stagger.item, 0.25)}
                reduceMotion={reduced}
              />
            ) : (
              <motion.span
                key={part.key}
                className={styles.symbol}
                {...columnPresence}
                transition={reduced ? { duration: 0 } : T.spring.morph}
              >
                {part.text}
              </motion.span>
            ),
          )}
        </AnimatePresence>
        {suffix && <span className={styles.symbol}>{suffix}</span>}
      </span>
    </span>
  );
}
