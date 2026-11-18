import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { cx, motionTokens } from "./motion-tokens";
import "./ui.css";

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
};

type SegmentedControlProps<T extends string> = {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onValueChange: (value: T) => void;
  /** Accessible name for the group. */
  label: string;
  className?: string;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  const id = useId();
  const reduced = useReducedMotion() ?? false;
  const trackRef = useRef<HTMLDivElement>(null);

  // Fade the track edges when its options overflow and scroll.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const update = () => {
      const remaining = track.scrollWidth - track.clientWidth - track.scrollLeft;
      track.toggleAttribute("data-fade-start", track.scrollLeft > 1);
      track.toggleAttribute("data-fade-end", remaining > 1);
    };
    update();
    track.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(track);
    return () => {
      track.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [options.length]);

  // Keep the selected option in view when the track scrolls.
  const firstRun = useRef(true);
  useEffect(() => {
    const track = trackRef.current;
    const selected = track?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!track || !selected || track.scrollWidth <= track.clientWidth) {
      firstRun.current = false;
      return;
    }
    const min = selected.offsetLeft - 20;
    const max = selected.offsetLeft + selected.offsetWidth + 20 - track.clientWidth;
    const left = track.scrollLeft > min ? min : track.scrollLeft < max ? max : track.scrollLeft;
    if (left !== track.scrollLeft) {
      track.scrollTo({
        left: Math.max(0, left),
        behavior: firstRun.current || reduced ? "auto" : "smooth",
      });
    }
    firstRun.current = false;
  }, [value, reduced]);

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    const { key } = event;
    const next =
      key === "ArrowRight" || key === "ArrowDown"
        ? selectedIndex === last
          ? 0
          : selectedIndex + 1
        : key === "ArrowLeft" || key === "ArrowUp"
          ? selectedIndex === 0
            ? last
            : selectedIndex - 1
          : key === "Home"
            ? 0
            : key === "End"
              ? last
              : -1;
    const option = options[next];
    if (next < 0 || !option) return;
    event.preventDefault();
    onValueChange(option.value);
    trackRef.current
      ?.querySelector<HTMLElement>(`[data-value="${CSS.escape(option.value)}"]`)
      ?.focus({ preventScroll: true });
  };

  return (
    <div className={cx("arc-segmented", className)} role="group" aria-label={label}>
      <LayoutGroup id={id}>
        <motion.div ref={trackRef} layoutScroll className="arc-segmented-track">
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                id={`${id}-${option.value}`}
                type="button"
                className="arc-segmented-button"
                data-value={option.value}
                aria-pressed={selected}
                tabIndex={index === selectedIndex ? 0 : -1}
                onClick={() => onValueChange(option.value)}
                onKeyDown={onKeyDown}
              >
                {selected ? (
                  <motion.span
                    className="arc-segmented-selection"
                    layoutId="selection"
                    layoutDependency={value}
                    transition={reduced ? { duration: 0 } : motionTokens.spring.morph}
                    aria-hidden="true"
                  />
                ) : null}
                <span className="arc-segmented-label">{option.label}</span>
              </button>
            );
          })}
        </motion.div>
      </LayoutGroup>
    </div>
  );
}
