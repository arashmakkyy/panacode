import { forwardRef, useCallback, useRef, type ReactNode, type RefObject } from "react";
import { motion, useReducedMotion, type HTMLMotionProps, type Variants } from "motion/react";
import { cx, motionTokens } from "./motion-tokens";
import "./ui.css";

export type ButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  children?: ReactNode;
};

/** Press feedback scales less on wide buttons and a little more on icon sized ones. */
const pressVariants: Variants = {
  pressed: (ref: RefObject<HTMLButtonElement | null>) => {
    const width = ref.current?.offsetWidth ?? 0;
    return {
      scale: width > 220 ? 0.985 : width && width <= 48 ? 0.96 : 0.97,
      transition: {
        duration: motionTokens.duration.instant,
        ease: motionTokens.ease.standard,
      },
    };
  },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", disabled, children, type = "button", ...rest },
  forwardedRef,
) {
  const reduced = useReducedMotion() ?? false;
  const localRef = useRef<HTMLButtonElement | null>(null);

  const setRef = useCallback(
    (node: HTMLButtonElement | null) => {
      localRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  return (
    <motion.button
      ref={setRef}
      type={type}
      tabIndex={0}
      className={cx(
        "arc-button",
        `arc-button-${variant}`,
        size === "sm" && "arc-button-sm",
        className,
      )}
      disabled={disabled}
      custom={localRef}
      variants={pressVariants}
      whileTap={reduced || disabled ? undefined : "pressed"}
      transition={motionTokens.spring.snappy}
      {...rest}
    >
      <span className="arc-button-label-slot">
        <span className="arc-button-label-content">
          <span className="arc-button-label-phase">{children}</span>
        </span>
      </span>
    </motion.button>
  );
});
