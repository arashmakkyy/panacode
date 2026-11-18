import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import * as Popover from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { Check, CircleAlert, Copy } from "lucide-react";
import s from "./chat.module.css";

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const EASE_ENTER: [number, number, number, number] = [0.16, 1, 0.3, 1];
/** Springs with no bounce, described by how long they look. */
export const FOLD = { type: "spring" as const, visualDuration: 0.26, bounce: 0 };
export const FOLD_SLOW = { type: "spring" as const, visualDuration: 0.32, bounce: 0 };

export const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("Copy failed");
}

/* ------------------------------------------------------------------ Swap */

/** Crossfades its content when `swapKey` changes while the box follows the new width on a spring. */
export function Swap({
  swapKey,
  children,
  reduced,
  className,
}: {
  swapKey: string;
  children: ReactNode;
  reduced: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const restWidth = useRef(0);
  const lastKey = useRef(swapKey);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || lastKey.current === swapKey) return;
    lastKey.current = swapKey;
    const from = el.style.width ? el.getBoundingClientRect().width : restWidth.current;
    el.style.width = "";
    const to = el.getBoundingClientRect().width;
    if (reduced || !from || Math.abs(from - to) < 1) return;
    const controls = animate(
      el,
      { width: [from, to] },
      {
        ...FOLD,
        onComplete: () => {
          el.style.width = "";
        },
      },
    );
    return () => controls.stop();
  }, [swapKey, reduced]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!el.style.width) restWidth.current = el.getBoundingClientRect().width;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <span ref={ref} className={cx(s.swap, className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={swapKey}
          className={s.swapItem}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.1, ease: EASE } }}
          transition={{ duration: reduced ? 0 : 0.16, ease: EASE }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Two icons stacked in one cell that crossfade when `swapKey` changes. */
export function IconSwap({
  swapKey,
  children,
  reduced,
  className,
}: {
  swapKey: string;
  children: ReactNode;
  reduced: boolean;
  className?: string;
}) {
  return (
    <span className={cx(s.iconCell, className)} aria-hidden="true">
      <AnimatePresence initial={false}>
        <motion.span
          key={swapKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.1 } }}
          transition={{ duration: reduced ? 0 : 0.16, ease: EASE }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Glides an element to its new natural height whenever `key` changes. */
export function useGlideHeight(ref: RefObject<HTMLElement | null>, key: string, reduced: boolean) {
  const restHeight = useRef(0);
  const lastKey = useRef(key);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!el.style.height) restHeight.current = el.getBoundingClientRect().height;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || lastKey.current === key) return;
    lastKey.current = key;
    const from = el.style.height ? el.getBoundingClientRect().height : restHeight.current;
    el.style.height = "";
    const to = el.getBoundingClientRect().height;
    if (reduced || !from || Math.abs(from - to) < 2) return;
    el.style.overflow = "clip";
    const controls = animate(
      el,
      { height: [from, to] },
      {
        ...FOLD,
        onComplete: () => {
          el.style.height = "";
          el.style.overflow = "";
        },
      },
    );
    return () => controls.stop();
  }, [key, reduced, ref]);
}

/* --------------------------------------------------------------- Tooltip */

/** Once one tooltip has shown, the next opens at once until the pointer rests for 300ms. */
const tooltipWarmth = (() => {
  let warm = false;
  let open = 0;
  let timer = 0;
  const listeners = new Set<() => void>();
  const set = (next: boolean) => {
    if (warm === next) return;
    warm = next;
    listeners.forEach((listener) => listener());
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => warm,
    opened() {
      open += 1;
      window.clearTimeout(timer);
      set(true);
    },
    closed() {
      open = Math.max(0, open - 1);
      if (open) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => set(false), 300);
    },
  };
})();

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const warm = useSyncExternalStore(tooltipWarmth.subscribe, tooltipWarmth.get, () => false);
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);

  useEffect(() => {
    if (!open) return;
    tooltipWarmth.opened();
    return tooltipWarmth.closed;
  }, [open]);

  return (
    <TooltipPrimitive.Provider delayDuration={250} skipDelayDuration={0}>
      <TooltipPrimitive.Root
        open={open}
        delayDuration={warm ? 0 : 250}
        onOpenChange={(next) => {
          if (next) setInstant(tooltipWarmth.get());
          setOpen(next);
        }}
      >
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            className={s.tooltip}
            data-instant={instant || undefined}
            side={side}
            sideOffset={8}
            collisionPadding={12}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/* ------------------------------------------------------------ Hover card */

interface HoverState {
  id: string | null;
  instant: boolean;
}

const NO_CARD: HoverState = { id: null, instant: false };

/** Only one hover card is open at a time; moving between triggers opens the next one fast. */
const hoverCards = (() => {
  let state = NO_CARD;
  let closedAt = -Infinity;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const warm = () => state.id !== null || performance.now() - closedAt < 300;
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => state,
    server: () => NO_CARD,
    warm,
    open(id: string) {
      if (state.id === id) return;
      state = { id, instant: warm() };
      emit();
    },
    close(id: string) {
      if (state.id !== id) return;
      state = NO_CARD;
      closedAt = performance.now();
      emit();
    },
  };
})();

export function HoverCard({
  children,
  content,
  side = "bottom",
  align = "start",
  openDelay = 500,
  closeDelay = 140,
  className,
}: {
  children: ReactElement;
  content: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  openDelay?: number;
  closeDelay?: number;
  className?: string;
}) {
  const id = useId();
  const cardId = `${id}-card`;
  const state = useSyncExternalStore(hoverCards.subscribe, hoverCards.get, hoverCards.server);
  const open = state.id === id;
  const reduced = useReducedMotion() ?? false;
  const anchor = useRef<HTMLDivElement>(null);
  const timers = useRef({ open: 0, close: 0 });
  const over = useRef({ trigger: false, card: false, focus: false });
  const dismissed = useRef(false);
  const pointer = useRef("");

  useEffect(() => {
    const held = timers.current;
    return () => {
      window.clearTimeout(held.open);
      window.clearTimeout(held.close);
      hoverCards.close(id);
    };
  }, [id]);

  const clearTimers = () => {
    window.clearTimeout(timers.current.open);
    window.clearTimeout(timers.current.close);
  };
  const show = () => {
    clearTimers();
    dismissed.current = false;
    hoverCards.open(id);
  };
  const hide = () => {
    clearTimers();
    hoverCards.close(id);
  };
  const leave = () => {
    window.clearTimeout(timers.current.open);
    const { trigger, card, focus } = over.current;
    if (trigger || card || focus) return;
    window.clearTimeout(timers.current.close);
    timers.current.close = window.setTimeout(() => hoverCards.close(id), closeDelay);
  };

  const still = state.instant || reduced;
  const offset = still ? 0 : side === "top" ? 4 : side === "bottom" ? -4 : 0;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) hide();
      }}
    >
      <Popover.Anchor
        asChild
        ref={anchor}
        aria-describedby={open ? cardId : undefined}
        data-hover-card={open ? "open" : "closed"}
        onPointerEnter={(event) => {
          if (event.pointerType === "touch") return;
          over.current.trigger = true;
          window.clearTimeout(timers.current.close);
          if (dismissed.current || hoverCards.get().id === id) return;
          window.clearTimeout(timers.current.open);
          timers.current.open = window.setTimeout(
            () => hoverCards.open(id),
            hoverCards.warm() ? 80 : openDelay,
          );
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "touch") return;
          over.current.trigger = false;
          dismissed.current = false;
          leave();
        }}
        onPointerDown={(event) => {
          pointer.current = event.pointerType;
        }}
        onClick={() => {
          const isOpen = hoverCards.get().id === id;
          if (pointer.current === "touch") {
            if (isOpen) hide();
            else show();
          } else if (!isOpen) show();
          pointer.current = "";
        }}
        onFocus={(event) => {
          if (!event.currentTarget.matches(":focus-visible")) return;
          over.current.focus = true;
          show();
        }}
        onBlur={() => {
          over.current.focus = false;
          dismissed.current = false;
          leave();
        }}
      >
        {children}
      </Popover.Anchor>
      <AnimatePresence>
        {open && (
          <Popover.Portal forceMount key="card">
            <Popover.Content
              forceMount
              asChild
              id={cardId}
              role="tooltip"
              side={side}
              align={align}
              sideOffset={8}
              collisionPadding={12}
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onEscapeKeyDown={() => {
                dismissed.current = true;
              }}
              onInteractOutside={(event) => {
                if (anchor.current?.contains(event.target as Node)) event.preventDefault();
              }}
              onPointerEnter={(event) => {
                if (event.pointerType === "touch") return;
                over.current.card = true;
                window.clearTimeout(timers.current.close);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === "touch") return;
                over.current.card = false;
                leave();
              }}
            >
              <motion.div
                className={cx(s.hoverCard, className)}
                initial={{ opacity: 0, y: offset, scale: still ? 1 : 0.96 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  scale: 1,
                  transition: {
                    default: still
                      ? { duration: 0.14, ease: EASE_ENTER }
                      : { type: "spring", visualDuration: 0.3, bounce: 0 },
                    opacity: { duration: reduced ? 0.15 : state.instant ? 0.09 : 0.16, ease: EASE_ENTER },
                  },
                }}
                exit={{
                  opacity: 0,
                  y: offset,
                  scale: still ? 1 : 0.96,
                  transition: { duration: reduced ? 0.1 : 0.12, ease: EASE },
                }}
              >
                {content}
              </motion.div>
            </Popover.Content>
          </Popover.Portal>
        )}
      </AnimatePresence>
    </Popover.Root>
  );
}

/* ---------------------------------------------------------- Text shimmer */

const SHIMMER_STOPS: Array<[number, number]> = [
  [-1, 0],
  [-0.5, 0.5],
  [-0.2, 0.9],
  [0, 1],
  [0.2, 0.9],
  [0.5, 0.5],
  [1, 0],
];

const percent = (value: number) => `${(100 * value).toFixed(1)}%`;

function shimmerGradient(progress: number) {
  const base = `color-mix(in oklab, var(--ts-highlight) ${percent(0)}, var(--ts-base))`;
  const stops = SHIMMER_STOPS.map(
    ([at, strength]) =>
      `color-mix(in oklab, var(--ts-highlight) ${percent(strength)}, ${base}) calc(${(100 * progress).toFixed(2)}% + ${((2 * progress - 1 + at) * 2.2).toFixed(3)}em)`,
  );
  return `linear-gradient(90deg, ${base}, ${stops.join(", ")}, ${base})`;
}

/** A calm band of light that crosses the words while work is ongoing. */
export function TextShimmer({ children, duration = 1.8 }: { children: ReactNode; duration?: number }) {
  const reduced = useReducedMotion() ?? false;
  const progress = useMotionValue(0);
  const backgroundImage = useTransform(progress, shimmerGradient);

  useEffect(() => {
    if (reduced) {
      progress.jump(0);
      return;
    }
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
  }, [reduced, duration, progress]);

  return (
    <span className={s.shimmer} data-state="active" aria-busy="true">
      <span className={s.shimmerStage}>
        <motion.span className={s.shimmerLabel} style={{ backgroundImage }}>
          {children}
        </motion.span>
      </span>
    </span>
  );
}

/* ---------------------------------------------------------------- Button */

export function Button({
  variant = "secondary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return <button type={type} className={cx(s.button, s[variant], className)} {...props} />;
}

/** A quiet copy button with a label that confirms in place. */
export function CopyButton({
  value,
  label = "Copy",
  className,
  disabled,
  reduced,
}: {
  value: string;
  label?: string;
  className?: string;
  disabled?: boolean;
  reduced: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    let ok = true;
    try {
      await copyText(value);
    } catch {
      ok = false;
    }
    setState(ok ? "copied" : "error");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1600);
  }

  return (
    <button type="button" className={cx(s.copyButton, className)} disabled={disabled} onClick={() => void copy()}>
      <IconSwap swapKey={state} reduced={reduced} className={s.copyIcon}>
        <span data-state={state}>
          {state === "copied" ? (
            <Check size={16} strokeWidth={1.75} />
          ) : state === "error" ? (
            <CircleAlert size={16} strokeWidth={1.75} />
          ) : (
            <Copy size={16} strokeWidth={1.75} />
          )}
        </span>
      </IconSwap>
      <Swap swapKey={state} reduced={reduced}>
        {state === "copied" ? "Copied" : state === "error" ? "Failed" : label}
      </Swap>
      <span className={s.srOnly} role="status" aria-live="polite">
        {state === "copied" ? "Copied to clipboard" : state === "error" ? "Could not copy" : ""}
      </span>
    </button>
  );
}
