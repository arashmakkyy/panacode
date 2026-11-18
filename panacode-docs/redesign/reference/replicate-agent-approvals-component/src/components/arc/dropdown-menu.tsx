import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type ReactNode } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { T } from "./motion";
import styles from "./dropdown-menu.module.css";

export interface DropdownMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect?: (event: Event) => void;
  destructive?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

/** The trigger label measures itself and morphs its width when the text changes. */
function MorphLabel({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const measureRef = useRef<HTMLSpanElement>(null);
  const lastText = useRef<string | null>(null);
  const [size, setSize] = useState<{ width: number | "auto"; animate: boolean }>({ width: "auto", animate: false });

  useLayoutEffect(() => {
    const node = measureRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const current = node.textContent;
      const changed = lastText.current !== null && lastText.current !== current;
      lastText.current = current;
      setSize({
        width: Math.ceil(entry.borderBoxSize?.[0]?.inlineSize ?? node.offsetWidth),
        animate: changed,
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.span
      className={styles.label}
      initial={false}
      animate={{ width: size.width }}
      transition={size.animate && !reduced ? T.spring.morph : { duration: 0 }}
    >
      <span ref={measureRef} className={styles.labelMeasure} aria-hidden="true">
        {text}
      </span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          className={styles.labelText}
          initial={!reduced && { opacity: 0, y: "0.3em", filter: `blur(${T.blur.soft}px)` }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={
            reduced
              ? { opacity: 0, transition: { duration: 0 } }
              : {
                  opacity: 0,
                  y: "-0.3em",
                  filter: `blur(${T.blur.subtle}px)`,
                  transition: { duration: T.duration.fast, ease: T.ease.standard },
                }
          }
          transition={{ duration: T.duration.standard, ease: T.ease.enter }}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}

interface Highlight {
  top: number;
  height: number;
  danger: boolean;
  glide: boolean;
}

export function DropdownMenu({ label, items, icon }: { label: string; items: DropdownMenuItem[]; icon?: ReactNode }) {
  const reduced = useReducedMotion();
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const pointerDriven = useRef(false);
  const clearTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(clearTimer.current), []);

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const item = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[role="menuitem"]') : null;
    window.clearTimeout(clearTimer.current);
    if (!item) {
      clearTimer.current = window.setTimeout(() => setHighlight(null), pointerDriven.current ? 70 : 0);
      return;
    }
    const next = { top: item.offsetTop, height: item.offsetHeight, danger: item.dataset.tone === "danger" };
    const glide = pointerDriven.current;
    setHighlight((previous) => ({ ...next, glide: glide && previous !== null }));
  };

  return (
    <Menu.Root
      onOpenChange={(open) => {
        if (open) {
          window.clearTimeout(clearTimer.current);
          setHighlight(null);
        }
      }}
    >
      <Menu.Trigger className={styles.trigger} type="button">
        {icon && (
          <span className={styles.triggerIcon} aria-hidden="true">
            {icon}
          </span>
        )}
        <MorphLabel text={label} />
        <ChevronDown className={styles.chevron} size={15} strokeWidth={1.8} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className={styles.menu}
          sideOffset={6}
          align="end"
          collisionPadding={12}
          loop
          onFocus={onFocus}
          onPointerMoveCapture={() => {
            pointerDriven.current = true;
          }}
          onKeyDownCapture={() => {
            pointerDriven.current = false;
          }}
        >
          <motion.span
            className={styles.highlight}
            data-tone={highlight?.danger ? "danger" : undefined}
            aria-hidden="true"
            initial={false}
            animate={highlight ? { y: highlight.top, height: highlight.height, opacity: 1 } : { opacity: 0 }}
            transition={{
              default: highlight?.glide && !reduced ? T.spring.snappy : { duration: 0 },
              opacity: { duration: reduced ? 0 : 0.08 },
            }}
          />
          {items.map((item, index) => (
            <Fragment key={item.label}>
              {item.separatorBefore && <Menu.Separator className={styles.separator} />}
              <Menu.Item
                className={[styles.item, item.destructive ? styles.destructive : ""].filter(Boolean).join(" ")}
                data-tone={item.destructive ? "danger" : undefined}
                style={{ "--i": index } as CSSProperties}
                disabled={item.disabled}
                onSelect={item.onSelect}
              >
                {item.icon && (
                  <span className={styles.icon} aria-hidden="true">
                    {item.icon}
                  </span>
                )}
                {item.label}
              </Menu.Item>
            </Fragment>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
