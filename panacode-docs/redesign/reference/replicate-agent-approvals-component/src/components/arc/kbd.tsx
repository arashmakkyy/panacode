import { useSyncExternalStore, type HTMLAttributes, type ReactNode } from "react";
import styles from "./kbd.module.css";

type Platform = "mac" | "pc";

interface ParsedKey {
  id: string;
  glyph: string;
  name: string;
}

const noopSubscribe = () => () => {};
const detectPlatform = (): Platform => {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent) ? "mac" : "pc";
};

export function usePlatform(platform: Platform | "auto" = "auto"): Platform {
  const detected = useSyncExternalStore(noopSubscribe, detectPlatform, () => "mac" as Platform);
  return platform === "auto" ? detected : platform;
}

function parseKey(raw: string, platform: Platform): ParsedKey {
  const key = raw.trim();
  const lower = key.toLowerCase();
  const mac = platform === "mac";
  switch (lower) {
    case "mod":
      return parseKey(mac ? "meta" : "ctrl", platform);
    case "meta":
    case "cmd":
    case "command":
    case "win":
    case "super":
      return { id: "meta", glyph: mac ? "⌘" : "Win", name: mac ? "Command" : "Windows" };
    case "ctrl":
    case "control":
      return { id: "ctrl", glyph: mac ? "⌃" : "Ctrl", name: "Control" };
    case "alt":
    case "option":
    case "opt":
      return { id: "alt", glyph: mac ? "⌥" : "Alt", name: mac ? "Option" : "Alt" };
    case "shift":
      return { id: "shift", glyph: mac ? "⇧" : "Shift", name: "Shift" };
    case "enter":
    case "return":
      return { id: lower, glyph: mac ? "↵" : "Enter", name: mac ? "Return" : "Enter" };
    case "esc":
    case "escape":
      return { id: "esc", glyph: "Esc", name: "Escape" };
    case "tab":
      return { id: lower, glyph: mac ? "⇥" : "Tab", name: "Tab" };
    case "backspace":
      return { id: lower, glyph: mac ? "⌫" : "Backspace", name: mac ? "Delete" : "Backspace" };
    case "space":
      return { id: lower, glyph: "Space", name: "Space" };
    case "up":
    case "arrowup":
      return { id: "up", glyph: "↑", name: "Up arrow" };
    case "down":
    case "arrowdown":
      return { id: "down", glyph: "↓", name: "Down arrow" };
    case "left":
    case "arrowleft":
      return { id: "left", glyph: "←", name: "Left arrow" };
    case "right":
    case "arrowright":
      return { id: "right", glyph: "→", name: "Right arrow" };
  }
  if (/^[a-z]$/.test(lower)) return { id: lower, glyph: lower.toUpperCase(), name: lower.toUpperCase() };
  if (/^[0-9]$/.test(lower)) return { id: lower, glyph: lower, name: lower };
  return {
    id: lower,
    glyph: key.length === 1 ? key : key.charAt(0).toUpperCase() + key.slice(1),
    name: key,
  };
}

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /** Keys joined with "+", for example "mod+k" or "Enter". */
  keys?: string | string[];
  children?: ReactNode;
  size?: "sm" | "md" | "lg";
  platform?: Platform | "auto";
  /** Shows the key cap pressed down. */
  pressed?: boolean;
}

export function Kbd({ keys, children, size = "md", platform = "auto", pressed = false, className, ...rest }: KbdProps) {
  const resolved = usePlatform(platform);
  const list =
    keys !== undefined
      ? typeof keys !== "string"
        ? [...keys]
        : keys.replace(/\+\+$/, "+plus").split("+").filter(Boolean)
      : typeof children === "string"
        ? [children]
        : [];
  const parsed = list.map((key) => parseKey(key, resolved));
  const classes = [styles.kbd, styles[size], className].filter(Boolean).join(" ");

  const cap = (glyph: ReactNode, name: string | null, index: number) => (
    <kbd key={index} className={styles.key} data-pressed={pressed ? "" : undefined}>
      {name === null ? (
        glyph
      ) : (
        <>
          <span className={styles.glyph} aria-hidden="true">
            {glyph}
          </span>
          <span className={styles.hidden}>{name}</span>
        </>
      )}
    </kbd>
  );

  if (keys === undefined) {
    const first = parsed[0];
    const differs = first && first.glyph !== first.name;
    return (
      <kbd {...rest} className={classes}>
        {cap(differs ? first.glyph : children, differs ? first.name : null, 0)}
      </kbd>
    );
  }

  return (
    <kbd {...rest} className={classes}>
      {parsed.map((key, index) => (
        <span key={`${key.id}-${index}`} className={styles.slot}>
          {index > 0 && <span className={styles.hidden}> </span>}
          {cap(key.glyph, key.glyph === key.name ? null : key.name, index)}
        </span>
      ))}
    </kbd>
  );
}
