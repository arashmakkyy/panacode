import {
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, type Variants } from "motion/react";
import { T } from "./motion";
import styles from "./button.module.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationEnd"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children?: ReactNode;
}

const pressVariants: Variants = {
  pressed: (ref: RefObject<HTMLButtonElement | null>) => {
    const width = ref.current?.offsetWidth ?? 0;
    return {
      scale: width > 220 ? 0.985 : width && width <= 48 ? 0.96 : 0.97,
      transition: { duration: T.duration.instant, ease: T.ease.standard },
    };
  },
};

const shown = { opacity: 1, y: 0, scale: 1 };
const textIn = { opacity: 0, y: 2 };
const textOut = { opacity: 0, transition: { duration: 0.1, ease: T.ease.standard } };
const iconIn = { opacity: 0, scale: 0.85 };
const iconOut = { opacity: 0, transition: { duration: 0.1, ease: T.ease.standard } };
const reducedIn = { ...shown, opacity: 0 };
const reducedOut = { opacity: 0, transition: { duration: T.duration.instant } };
const iconSpring = { ...T.spring.snappy, opacity: { duration: T.duration.fast, ease: T.ease.enter } };

/** Turns children into a stable string key so a label change crossfades. */
function labelKey(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return String(node);
  if (Array.isArray(node)) return node.map(labelKey).join("");
  if (!isValidElement(node)) return "";
  const type = node.type as unknown;
  const name =
    typeof type === "string"
      ? type
      : ((type as { displayName?: string; name?: string } | null)?.displayName ??
        (type as { name?: string } | null)?.name ??
        "");
  return `<${name}>${labelKey((node.props as { children?: ReactNode }).children)}`;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading = false, disabled, children, onClick, type = "button", ...rest },
  forwardedRef,
) {
  const reduced = useReducedMotion() ?? false;
  const innerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLSpanElement | null>(null);
  const key = labelKey(children);

  /* Label slot width follows the label on a morph spring when the text changes. */
  const width = useMotionValue<number | "auto">("auto");
  const lastKey = useRef(key);
  const morphUntil = useRef(0);
  useLayoutEffect(() => {
    if (lastKey.current !== key) {
      lastKey.current = key;
      morphUntil.current = performance.now() + 700;
    }
  }, [key]);
  useEffect(() => {
    const content = contentRef.current;
    const slot = content?.parentElement;
    if (!content || !slot || typeof ResizeObserver === "undefined") return;
    let measured = false;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = entry.contentRect.width;
      if (!next || !measured || reduced || performance.now() > morphUntil.current) {
        measured = next > 0;
        width.jump(next || "auto");
        delete slot.dataset.morphing;
        return;
      }
      slot.dataset.morphing = "";
      animate(width, next, {
        ...T.spring.morph,
        onComplete: () => {
          delete slot.dataset.morphing;
        },
      });
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [reduced, width]);

  const setRef = useCallback(
    (node: HTMLButtonElement | null) => {
      innerRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  const hasPopup = rest["aria-haspopup"];
  const opensSomething =
    (hasPopup !== undefined && hasPopup !== false && hasPopup !== "false") ||
    rest.role === "combobox" ||
    (rest as Record<string, unknown>)["data-state"] !== undefined;
  const inert = disabled || loading || rest["aria-disabled"] === true || rest["aria-disabled"] === "true";
  const classes = [styles.button, styles[variant], styles[size], className].filter(Boolean).join(" ");
  const iconOnly = !/\S/.test(key.replace(/<[^>]*>/g, ""));

  return (
    <motion.button
      ref={setRef}
      type={type}
      tabIndex={rest.tabIndex ?? 0}
      className={classes}
      disabled={disabled}
      aria-busy={loading || undefined}
      custom={innerRef}
      variants={pressVariants}
      whileTap={reduced || opensSomething || inert ? undefined : "pressed"}
      transition={T.spring.snappy}
      {...(rest as Record<string, unknown>)}
      aria-disabled={loading || rest["aria-disabled"] || undefined}
      onClick={loading ? (event) => event.preventDefault() : onClick}
    >
      <AnimatePresence initial={false}>
        {loading ? (
          <motion.span
            key="loader"
            className={styles.loader}
            aria-hidden="true"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduced ? reducedOut : { ...iconOut, scale: 0.8 }}
            transition={reduced ? { duration: T.duration.instant } : iconSpring}
          >
            <span className={styles.spinner} />
          </motion.span>
        ) : null}
      </AnimatePresence>
      <motion.span
        className={[styles.labelSlot, loading ? styles.loadingLabel : ""].filter(Boolean).join(" ")}
        style={{ width }}
      >
        <span ref={contentRef} className={styles.labelContent}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={key}
              className={styles.labelPhase}
              initial={reduced ? reducedIn : iconOnly ? iconIn : textIn}
              animate={shown}
              exit={reduced ? reducedOut : iconOnly ? iconOut : textOut}
              transition={
                reduced
                  ? { duration: T.duration.instant }
                  : iconOnly
                    ? iconSpring
                    : { duration: T.duration.standard, ease: T.ease.enter }
              }
            >
              {children}
            </motion.span>
          </AnimatePresence>
        </span>
      </motion.span>
    </motion.button>
  );
});
