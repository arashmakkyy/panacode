import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { cn } from "../../utils/cn";
import { CheckIcon, CopyIcon } from "./icons";

export function useReduced() {
  return !!useReducedMotion();
}

/* ───────── Counter: writes straight to the DOM, never re-renders its parent ───────── */

const nf = new Intl.NumberFormat("en-US");

export const Counter = memo(function Counter({
  value,
  format = "int",
  className,
}: {
  value: number;
  format?: "int" | "cost" | "sec" | "x";
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  const reduced = useReduced();

  const fmt = useCallback(
    (v: number) =>
      format === "cost"
        ? `$${v.toFixed(4)}`
        : format === "sec"
          ? `${(v / 1000).toFixed(1)}s`
          : format === "x"
            ? `${v.toFixed(1)}×`
            : nf.format(Math.round(v)),
    [format],
  );

  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = fmt(shown.current);
  }, [fmt]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced || shown.current === value) {
      shown.current = value;
      el.textContent = fmt(value);
      return;
    }
    const controls = animate(shown.current, value, {
      duration: Math.min(0.7, 0.28 + Math.abs(value - shown.current) / Math.max(1, value) * 0.5),
      ease: [0.2, 0.7, 0.2, 1],
      onUpdate: v => {
        shown.current = v;
        el.textContent = fmt(v);
      },
    });
    return () => controls.stop();
  }, [value, reduced, fmt]);

  return <span ref={ref} className={cn("tabular-nums", className)} />;
});

/* ───────── Elapsed: ticks in tenths, DOM-only ───────── */

export const Elapsed = memo(function Elapsed({
  start,
  end,
  className,
}: {
  start?: number;
  end?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const write = (t: number) => {
      el.textContent = start === undefined ? "0.0s" : `${(Math.max(0, t - start) / 1000).toFixed(1)}s`;
    };
    if (start === undefined || end !== undefined) {
      write(end ?? 0);
      return;
    }
    write(performance.now());
    const id = window.setInterval(() => write(performance.now()), 100);
    return () => window.clearInterval(id);
  }, [start, end]);
  return <span ref={ref} className={cn("tabular-nums", className)} />;
});

export const Countdown = memo(function Countdown({ until, className }: { until: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const write = () => {
      el.textContent = `${(Math.max(0, until - performance.now()) / 1000).toFixed(1)}s`;
    };
    write();
    const id = window.setInterval(write, 100);
    return () => window.clearInterval(id);
  }, [until]);
  return <span ref={ref} className={cn("tabular-nums", className)} />;
});

/* ───────── Swap: old label fades out in 100ms, new one fades in over 160ms from 2px below ───────── */

export function Swap({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const reduced = useReduced();
  if (reduced) return <span className={cn("block min-w-0", className)}>{children}</span>;
  return (
    <span className={cn("relative block min-w-0", className)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={id}
          className="block min-w-0"
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.16, ease: "easeOut" } }}
          exit={{ opacity: 0, transition: { duration: 0.1, ease: "easeIn" } }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ───────── ChunkText: a few words at a time, each chunk only fades in ───────── */

export const ChunkText = memo(function ChunkText({
  text,
  active = true,
  wordsPerChunk = 3,
  interval = 70,
  className,
}: {
  text: string;
  active?: boolean;
  wordsPerChunk?: number;
  interval?: number;
  className?: string;
}) {
  const reduced = useReduced();
  const chunks = useMemo(() => {
    const words = text.match(/\S+\s*/g) ?? []; // keep trailing spaces
    const out: string[] = [];
    for (let i = 0; i < words.length; i += wordsPerChunk) out.push(words.slice(i, i + wordsPerChunk).join(""));
    return out;
  }, [text, wordsPerChunk]);

  const instant = reduced || !active;
  const [count, setCount] = useState(instant ? chunks.length : 0);

  useEffect(() => {
    if (instant) {
      setCount(chunks.length);
      return;
    }
    setCount(c => (c > chunks.length ? 0 : c));
    const id = window.setInterval(() => {
      setCount(c => {
        if (c >= chunks.length) {
          window.clearInterval(id);
          return c;
        }
        return c + 1;
      });
    }, interval);
    return () => window.clearInterval(id);
  }, [instant, chunks.length, interval]);

  const shown = instant ? chunks.length : count;
  return (
    <span className={className}>
      {chunks.slice(0, shown).map((c, i) => (
        <span key={i} className={instant ? undefined : "arc-chunk"}>
          {c}
        </span>
      ))}
    </span>
  );
});

/* ───────── Summary stream: every delta fades in as it lands ───────── */

export const DeltaText = memo(function DeltaText({ parts, className }: { parts: string[]; className?: string }) {
  const reduced = useReduced();
  return (
    <span className={className}>
      {parts.map((p, i) => (
        <span key={i} className={reduced ? undefined : "arc-chunk"}>
          {p}
        </span>
      ))}
    </span>
  );
});

/* ───────── StreamLine: one line on a steady rAF clock that glides left under a soft edge ───────── */

export const StreamLine = memo(function StreamLine({
  text,
  streaming,
  placeholder,
  className,
}: {
  text: string;
  streaming: boolean;
  placeholder?: string;
  className?: string;
}) {
  const reduced = useReduced();
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const target = useRef(text);
  const shown = useRef(0);
  const offset = useRef(0);
  const raf = useRef(0);
  const last = useRef(0);
  const [overflow, setOverflow] = useState(false);
  const live = streaming && !reduced;

  if (!text.startsWith(target.current)) shown.current = 0; // a new line replaced the old one
  target.current = text;

  const paint = useCallback(() => {
    const el = inner.current;
    const wrap = box.current;
    if (!el || !wrap) return;
    const t = target.current;
    if (shown.current > t.length) shown.current = 0;
    el.textContent = t.slice(0, Math.floor(shown.current));
    const over = Math.max(0, el.offsetWidth - wrap.clientWidth + 6);
    // glide: ease the offset toward the newest words
    offset.current += (over - offset.current) * 0.18;
    if (Math.abs(over - offset.current) < 0.3) offset.current = over;
    el.style.transform = `translate3d(${-offset.current}px,0,0)`;
    setOverflow(prev => (prev === over > 0 ? prev : over > 0));
  }, []);

  useEffect(() => {
    if (!live) {
      cancelAnimationFrame(raf.current);
      return;
    }
    last.current = performance.now();
    shown.current = 0;
    offset.current = 0;
    const tick = (now: number) => {
      const dt = Math.min(64, now - last.current);
      last.current = now;
      const backlog = target.current.length - shown.current;
      if (backlog < 0) shown.current = 0;
      else if (backlog > 0) {
        // steady clock: ~58 chars/s, catching up gently when far behind
        const cps = 58 + Math.max(0, backlog - 14) * 3.2;
        shown.current = Math.min(target.current.length, shown.current + (cps * dt) / 1000);
      }
      paint();
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [live, paint]);

  // a settled line rests at the start with an ellipsis
  if (!live || !text) {
    const display = text || placeholder || "";
    return (
      <span className={cn("block min-w-0 truncate", !text && "text-fg3", className)} title={display || undefined}>
        {display || "\u00A0"}
      </span>
    );
  }

  return (
    <span ref={box} className={cn("relative block min-w-0 overflow-hidden whitespace-nowrap", overflow && "arc-edge-mask", className)}>
      <span ref={inner} className="inline-block whitespace-pre will-change-transform">
        {"\u00A0"}
      </span>
    </span>
  );
});

/* ───────── Button ───────── */

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-8 select-none items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium",
        "transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.97]",
        "outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        variant === "primary" && "bg-fg text-card hover:opacity-90",
        variant === "secondary" && "border border-line-strong bg-card text-fg hover:bg-sunken",
        variant === "ghost" && "text-fg2 hover:bg-sunken hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ───────── Copy button ───────── */

export function CopyButton({ text, label = "Copy summary" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
      ta.remove();
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Button variant="ghost" onClick={copy} aria-label={copied ? "Summary copied" : label} className="h-7 gap-1.5 px-2 text-xs">
      <span className="relative grid size-3.5 place-items-center">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={copied ? "ok" : "copy"}
            className={cn("absolute", copied && "text-ok")}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </motion.span>
        </AnimatePresence>
      </span>
      <span>{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}

/* ───────── Segmented control (radiogroup with roving tabindex) ───────── */

export function Segmented({
  value,
  min = 1,
  max,
  onChange,
  label,
  idPrefix,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  idPrefix: string;
}) {
  const reduced = useReduced();
  const options = useMemo(() => Array.from({ length: max - min + 1 }, (_, i) => min + i), [min, max]);
  const refs = useRef<Record<number, HTMLButtonElement | null>>({});

  const pick = (v: number) => {
    const next = Math.min(max, Math.max(min, v));
    onChange(next);
    refs.current[next]?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        e.preventDefault();
        pick(value + 1);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        e.preventDefault();
        pick(value - 1);
        break;
      case "Home":
        e.preventDefault();
        pick(min);
        break;
      case "End":
        e.preventDefault();
        pick(max);
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKey}
      className="relative inline-flex h-8 items-center rounded-lg bg-sunken p-0.5 ring-1 ring-inset ring-line"
    >
      {options.map(o => {
        const on = o === value;
        return (
          <button
            key={o}
            ref={el => {
              refs.current[o] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o)}
            className={cn(
              "relative z-10 grid h-7 min-w-7 place-items-center rounded-md px-2 text-[13px] font-medium tabular-nums outline-none transition-colors duration-150",
              "focus-visible:ring-2 focus-visible:ring-focus",
              on ? "text-fg" : "text-fg3 hover:text-fg2",
            )}
          >
            {on && (
              <motion.span
                layoutId={`${idPrefix}-seg`}
                className="absolute inset-0 -z-10 rounded-md bg-card shadow-[0_1px_2px_rgba(0,0,0,0.12)] ring-1 ring-line"
                transition={reduced ? { duration: 0 } : { type: "spring", duration: 0.32, bounce: 0.08 }}
              />
            )}
            {o}
          </button>
        );
      })}
    </div>
  );
}
