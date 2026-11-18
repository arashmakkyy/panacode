import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CircleAlert, Copy } from "lucide-react";
import { cx, tokens } from "./tokens";
import "./arc.css";

type CopyState = "idle" | "copied" | "error";

const ease = tokens.ease.standard;
const swapIn = { duration: 0.16, ease };
const swapOut = { duration: 0.1, ease };
const none = { duration: 0 };

function useCopy(resetAfter = 1600) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(
    async (value: string) => {
      let ok = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
          ok = true;
        }
      } catch {
        ok = false;
      }
      if (!ok) {
        try {
          const area = document.createElement("textarea");
          area.value = value;
          area.setAttribute("readonly", "");
          area.style.position = "fixed";
          area.style.opacity = "0";
          document.body.appendChild(area);
          area.select();
          ok = document.execCommand("copy");
          area.remove();
        } catch {
          ok = false;
        }
      }
      setState(ok ? "copied" : "error");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState("idle"), resetAfter);
      return ok;
    },
    [resetAfter],
  );

  return { state, copy };
}

function DrawnCheck({ reduced }: { reduced: boolean }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <motion.path
        d="M4 12l5 5L20 6"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.22, ease, delay: 0.04 }}
      />
    </svg>
  );
}

/** Icon-only copy control with an in-place confirmation, as used under a reply. */
export function CopyButton({
  value,
  label = "Copy",
  className,
  variant = "outline",
  disabled,
  onCopied,
}: {
  value: string;
  label?: string;
  className?: string;
  variant?: "outline" | "plain";
  disabled?: boolean;
  onCopied?: () => void;
}) {
  const { state, copy } = useCopy();
  const reduced = useReducedMotion() ?? false;

  async function handleClick() {
    if (await copy(value)) onCopied?.();
  }

  return (
    <>
      <button
        type="button"
        className={cx("cb-button", "cb-iconOnly", variant === "plain" && "cb-plain", className)}
        onClick={() => void handleClick()}
        aria-label={label}
        data-copy-state={state}
        disabled={disabled}
      >
        <span className="cb-icon" aria-hidden="true">
          <AnimatePresence initial={false}>
            <motion.span
              key={state}
              className="cb-iconInner"
              data-state={state}
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, transition: reduced ? none : swapOut }}
              transition={reduced ? none : swapIn}
            >
              {state === "copied" ? (
                <DrawnCheck reduced={reduced} />
              ) : state === "error" ? (
                <CircleAlert size={16} strokeWidth={1.75} />
              ) : (
                <Copy size={16} strokeWidth={1.75} />
              )}
            </motion.span>
          </AnimatePresence>
        </span>
      </button>
      <span className="cb-srOnly" role="status" aria-live="polite">
        {state === "idle" ? "" : state === "error" ? `${label}: Could not copy` : `${label}: Copied`}
      </span>
    </>
  );
}
