import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { tokens } from "./tokens";
import "./arc.css";

/* One shared "a tooltip was just open" flag, so moving between neighbours opens the next one at once. */
let warm = false;
let openCount = 0;
let coolTimer = 0;
const listeners = new Set<() => void>();
const warmStore = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: () => warm,
  set(value: boolean) {
    if (warm !== value) {
      warm = value;
      listeners.forEach((listener) => listener());
    }
  },
  opened() {
    openCount += 1;
    window.clearTimeout(coolTimer);
    warmStore.set(true);
  },
  closed() {
    openCount = Math.max(0, openCount - 1);
    if (!openCount) {
      window.clearTimeout(coolTimer);
      coolTimer = window.setTimeout(() => warmStore.set(false), 300);
    }
  },
};

function MorphText({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const measureRef = useRef<HTMLSpanElement>(null);
  const lastText = useRef<string | null>(null);
  const [box, setBox] = useState<{ width: number; height: number; animate: boolean } | null>(null);

  useLayoutEffect(() => {
    const node = measureRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const size = entry.borderBoxSize?.[0];
      const content = node.textContent;
      const changed = lastText.current !== null && lastText.current !== content;
      lastText.current = content;
      setBox({
        width: Math.ceil(size?.inlineSize ?? node.offsetWidth),
        height: Math.ceil(size?.blockSize ?? node.offsetHeight),
        animate: changed,
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.span
      className="tt-text"
      initial={false}
      animate={box ? { width: box.width, height: box.height } : undefined}
      transition={box?.animate && !reduced ? tokens.spring.morph : { duration: 0 }}
    >
      <span ref={measureRef} className="tt-measure" aria-hidden="true">
        {text}
      </span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          className="tt-line"
          initial={reduced ? false : { opacity: 0, y: "0.3em", filter: `blur(${tokens.blur.soft}px)` }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={
            reduced
              ? { opacity: 0, transition: { duration: 0 } }
              : {
                  opacity: 0,
                  y: "-0.3em",
                  filter: `blur(${tokens.blur.subtle}px)`,
                  transition: { duration: tokens.duration.instant, ease: tokens.ease.standard },
                }
          }
          transition={{ duration: tokens.duration.standard, ease: tokens.ease.enter }}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  const isWarm = useSyncExternalStore(warmStore.subscribe, warmStore.get, () => false);
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);

  useEffect(() => {
    if (!open) return;
    warmStore.opened();
    return () => warmStore.closed();
  }, [open]);

  return (
    <RadixTooltip.Provider delayDuration={250} skipDelayDuration={0}>
      <RadixTooltip.Root
        open={open}
        delayDuration={isWarm ? 0 : 250}
        onOpenChange={(next) => {
          if (next) setInstant(warmStore.get());
          setOpen(next);
        }}
      >
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            className="tt-tooltip"
            data-instant={instant || undefined}
            side={side}
            sideOffset={8}
            collisionPadding={12}
          >
            {typeof content === "string" || typeof content === "number" ? <MorphText text={String(content)} /> : content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
