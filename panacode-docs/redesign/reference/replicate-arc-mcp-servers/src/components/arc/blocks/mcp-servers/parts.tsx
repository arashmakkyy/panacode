"use client";

import { useId, type ReactNode, type SVGProps } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, CircleCheck, Eye, KeyRound, PencilLine } from "lucide-react";
import { AnimatedCounter } from "../../animated-counter/animated-counter";
import { motionTokens } from "../../lib/motion-tokens";
import { Switch } from "../../switch/switch";
import { TextShimmer } from "../../text-shimmer/text-shimmer";
import { brandGlyphs, mcpGlyph, type BrandGlyph, type McpBrand } from "./brand-glyphs";
import { compactTokens, formatTokens } from "./format";
import type { McpAccess, McpReportedTool, McpStatus } from "./types";
import styles from "./mcp-servers.module.css";

export const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

/* ------------------------------------------------------------------ Motion */

type Bezier = [number, number, number, number];

export const easeEnter: Bezier = [...motionTokens.ease.enter];
export const easeStandard: Bezier = [...motionTokens.ease.standard];

/** Critically damped, so widths and heights settle without overshoot. */
export const settle = { type: "spring", visualDuration: 0.3, bounce: 0 } as const;
/** Labels and actions cross fade: about 160ms in, 100ms out. */
export const fadeIn = { duration: motionTokens.duration.fast, ease: easeEnter };
export const fadeOut = { duration: 0.1, ease: easeStandard };
/** Reduced motion: the new state appears in place. */
export const still = { duration: 0 };

/* ------------------------------------------------------------------ Marks */

interface MarkProps extends Omit<SVGProps<SVGSVGElement>, "title"> {
  /** Accessible name. Pass aria-hidden when the mark sits next to its name. */
  title?: string;
}

/** The Model Context Protocol mark. */
export function McpMark({ title = "Model Context Protocol", ...props }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" role="img" aria-label={title} {...props}>
      {mcpGlyph.map(d => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** The sample agent's mark: a two tone north arrow. Pass your own through `clientMark`. */
export function NorthwindMark({ title = "Northwind", ...props }: MarkProps) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} role="img" aria-label={title} {...props}>
      <defs>
        <linearGradient id={`${id}-lee`} x1="8" y1="3" x2="8" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="currentColor" stopOpacity=".42" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".72" />
        </linearGradient>
        <linearGradient id={`${id}-windward`} x1="16" y1="3" x2="16" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="currentColor" stopOpacity=".88" />
          <stop offset="1" stopColor="currentColor" stopOpacity="1" />
        </linearGradient>
      </defs>
      <path d="M12 2.5 4.75 20.75 12 16.9Z" fill={`url(#${id}-lee)`} />
      <path d="M12 2.5 19.25 20.75 12 16.9Z" fill={`url(#${id}-windward)`} />
    </svg>
  );
}

/** A server's real mark, or the MCP mark when it has no brand. Always decorative: the name sits beside it. */
export function BrandMark({ brand, className }: { brand?: McpBrand; className?: string }) {
  const glyph = brand ? (brandGlyphs as Record<string, BrandGlyph | undefined>)[brand] : undefined;
  if (!glyph) return <McpMark className={cx(styles.mark, className)} aria-hidden="true" />;
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" role="img" aria-label={glyph.title} className={cx(styles.mark, className)} data-brand={brand} aria-hidden="true">
      {glyph.paths.map(d => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ Cross fade */

interface SwapProps {
  /** Changing the id cross fades to the new children. */
  id: string;
  reduced: boolean;
  className?: string;
  children: ReactNode;
}

/** Swaps its content in place. The outgoing state leaves the flow at once, so the slot takes the new width. */
export function Swap({ id, reduced, className, children }: SwapProps) {
  return (
    <span className={cx(styles.swap, className)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={id}
          className={styles.swapItem}
          initial={{ opacity: 0, y: reduced ? 0 : 2 }}
          animate={{ opacity: 1, y: 0, transition: reduced ? still : fadeIn }}
          exit={{ opacity: 0, transition: reduced ? still : fadeOut }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ------------------------------------------------------------------ Numbers */

/** A whole number that rolls to its new value. */
export function Count({ value }: { value: number }) {
  return (
    <span className={styles.counter}>
      <AnimatedCounter value={value} />
    </span>
  );
}

/** A token count that rolls: whole below 1,000, then one decimal with a k. */
export function TokenCount({ value }: { value: number }) {
  const compact = compactTokens(value);
  return (
    <span className={styles.counter}>
      <AnimatedCounter value={compact.value} decimals={compact.decimals} suffix={compact.suffix} />
    </span>
  );
}

/* ------------------------------------------------------------------ Status and access */

const STATUS_ICON = { connected: CircleCheck, "needs-auth": KeyRound, error: CircleAlert } as const;

export const STATUS_LABEL: Record<McpStatus, string> = { connected: "Connected", "needs-auth": "Needs sign in", error: "Error" };

interface StatusLabelProps {
  status: McpStatus;
  /** A short verb such as "Connecting" while the server is being reached. It replaces the status. */
  working: string | null;
  reduced: boolean;
}

/** An icon in its semantic color plus a word, never color alone. */
export function StatusLabel({ status, working, reduced }: StatusLabelProps) {
  const Icon = STATUS_ICON[status];
  return (
    <Swap id={working ? `working-${working}` : status} reduced={reduced}>
      {working ? (
        <span className={styles.status} data-status="working">
          <TextShimmer>{working}</TextShimmer>
        </span>
      ) : (
        <span className={styles.status} data-status={status}>
          <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
          {STATUS_LABEL[status]}
        </span>
      )}
    </Swap>
  );
}

/** An eye for read tools, a pen for write tools, each with its word. */
export function AccessLabel({ access }: { access: McpAccess }) {
  const Icon = access === "read" ? Eye : PencilLine;
  return (
    <span className={styles.access} data-access={access}>
      <Icon size={13} strokeWidth={1.75} aria-hidden="true" />
      <span className={styles.accessText}>{access === "read" ? "Read" : "Write"}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ Tool row */

interface ToolFieldsProps {
  tool: McpReportedTool;
  enabled: boolean;
  /** Ties the name to the switch, so clicking the name toggles the tool. */
  switchId: string;
  onChange: (enabled: boolean) => void;
}

/** The four cells of a tool row: name, access, token cost and switch. The caller supplies the list item. */
export function ToolFields({ tool, enabled, switchId, onChange }: ToolFieldsProps) {
  return (
    <>
      <label htmlFor={switchId} className={styles.toolName}>
        {tool.name}
      </label>
      <AccessLabel access={tool.access} />
      <span className={styles.toolTokens}>{formatTokens(tool.tokens)}</span>
      <Switch id={switchId} className={styles.toolSwitch} checked={enabled} onCheckedChange={onChange} aria-label={`${tool.name}, ${tool.access} tool, ${tool.tokens} tokens`} />
    </>
  );
}
