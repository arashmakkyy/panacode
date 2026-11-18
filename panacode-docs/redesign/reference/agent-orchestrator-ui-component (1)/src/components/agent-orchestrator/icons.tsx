import type { SVGProps } from "react";
import type { LaneStatus } from "./types";

type P = SVGProps<SVGSVGElement>;

const base = (size: number): P => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
});

/* ───────── Model marks (simple originals, not brand assets) ───────── */

export function SparkMark({ size = 14, ...p }: P & { size?: number }) {
  return (
    <svg {...base(size)} strokeWidth={1.6} {...p}>
      <path d="M8 1.8v12.4M1.8 8h12.4M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8" />
    </svg>
  );
}

export function StarMark({ size = 14, ...p }: P & { size?: number }) {
  return (
    <svg {...base(size)} fill="currentColor" stroke="none" {...p}>
      <path d="M8 1c.5 3.9 2.1 5.5 7 7-4.9 1.5-6.5 3.1-7 7-.5-3.9-2.1-5.5-7-7 4.9-1.5 6.5-3.1 7-7Z" />
    </svg>
  );
}

export function KnotMark({ size = 14, ...p }: P & { size?: number }) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M8 1.6 13.5 4.8v6.4L8 14.4 2.5 11.2V4.8L8 1.6Z" />
      <path d="M8 1.6v6.4m0 0 5.5 3.2M8 8 2.5 11.2" />
    </svg>
  );
}

export function LeafMark({ size = 14, ...p }: P & { size?: number }) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M3 13c0-6 3-9.5 10-10 0 6.5-3.5 10-10 10Z" />
      <path d="M3 13c2-3 4-5 6.5-6.5" />
    </svg>
  );
}

/* ───────── Tool icons ───────── */

export function ToolIcon({ tool, size = 13 }: { tool: string; size?: number }) {
  switch (tool) {
    case "web_search":
      return (
        <svg {...base(size)}>
          <circle cx="7" cy="7" r="4.2" />
          <path d="m10.2 10.2 3.4 3.4" />
        </svg>
      );
    case "fetch_page":
      return (
        <svg {...base(size)}>
          <circle cx="8" cy="8" r="6" />
          <path d="M2 8h12M8 2c2 1.8 3 3.8 3 6s-1 4.2-3 6c-2-1.8-3-3.8-3-6s1-4.2 3-6Z" />
        </svg>
      );
    case "read_file":
      return (
        <svg {...base(size)}>
          <path d="M4 1.8h5l3.2 3.2v9.2H4V1.8Z" />
          <path d="M9 1.8V5h3.2M6 8.5h4M6 11h4" />
        </svg>
      );
    case "write_findings":
      return (
        <svg {...base(size)}>
          <path d="m3 13 .6-3L11 2.6a1.4 1.4 0 0 1 2 0l.4.4a1.4 1.4 0 0 1 0 2L6 12.4 3 13Z" />
          <path d="m9.6 4 2.4 2.4" />
        </svg>
      );
    default:
      return (
        <svg {...base(size)}>
          <path d="m3 4.5 3.5 3.5L3 11.5M8 12h5" />
        </svg>
      );
  }
}

export const TOOL_LABELS: Record<string, string> = {
  web_search: "Web search",
  fetch_page: "Fetch page",
  read_file: "Read file",
  write_findings: "Write findings",
};

export function toolLabel(tool: string) {
  return (
    TOOL_LABELS[tool] ??
    tool
      .replace(/[_-]+/g, " ")
      .replace(/^\w/, c => c.toUpperCase())
  );
}

/* ───────── Status glyphs ───────── */

export function StatusGlyph({ status, spin = true, size = 13 }: { status: LaneStatus; spin?: boolean; size?: number }) {
  switch (status) {
    case "waiting":
      return (
        <svg {...base(size)} strokeDasharray="2 2.6">
          <circle cx="8" cy="8" r="5.6" />
        </svg>
      );
    case "planned":
      return (
        <svg {...base(size)}>
          <circle cx="8" cy="8" r="5.6" />
          <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "queued":
      return (
        <svg {...base(size)}>
          <path d="M2.5 4.5h11M2.5 8h8M2.5 11.5h5" />
        </svg>
      );
    case "starting":
    case "running":
      return (
        <svg {...base(size)} className={spin ? "arc-spin" : undefined}>
          <circle cx="8" cy="8" r="5.6" opacity={0.22} />
          <path d="M8 2.4a5.6 5.6 0 0 1 5.6 5.6" />
        </svg>
      );
    case "failed":
      return (
        <svg {...base(size)}>
          <path d="M8 2 14.2 13H1.8L8 2Z" />
          <path d="M8 6.4v3M8 11.3v.01" />
        </svg>
      );
    case "returned":
      return (
        <svg {...base(size)}>
          <circle cx="8" cy="8" r="5.6" />
          <path d="m5.6 8.2 1.8 1.8 3.2-3.6" />
        </svg>
      );
    case "gaveup":
      return (
        <svg {...base(size)}>
          <circle cx="8" cy="8" r="5.6" />
          <path d="m5.9 5.9 4.2 4.2M10.1 5.9l-4.2 4.2" />
        </svg>
      );
    case "stopped":
      return (
        <svg {...base(size)}>
          <rect x="3.6" y="3.6" width="8.8" height="8.8" rx="2" />
        </svg>
      );
  }
}

/* ───────── UI icons ───────── */

export function PlayIcon({ size = 13 }: { size?: number }) {
  return (
    <svg {...base(size)} fill="currentColor" stroke="none">
      <path d="M4.5 2.9v10.2a.6.6 0 0 0 .9.5l8.2-5.1a.6.6 0 0 0 0-1L5.4 2.4a.6.6 0 0 0-.9.5Z" />
    </svg>
  );
}
export function StopIcon({ size = 13 }: { size?: number }) {
  return (
    <svg {...base(size)} fill="currentColor" stroke="none">
      <rect x="3.5" y="3.5" width="9" height="9" rx="2" />
    </svg>
  );
}
export function RerunIcon({ size = 13 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <path d="M13.2 8A5.2 5.2 0 1 1 11.6 4.3" />
      <path d="M13.4 2.2v2.6h-2.6" />
    </svg>
  );
}
export function CopyIcon({ size = 13 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <rect x="5.2" y="5.2" width="8" height="8" rx="2" />
      <path d="M10.8 5.2V4a1.8 1.8 0 0 0-1.8-1.8H4A1.8 1.8 0 0 0 2.2 4v5A1.8 1.8 0 0 0 4 10.8h1.2" />
    </svg>
  );
}
export function CheckIcon({ size = 13 }: { size?: number }) {
  return (
    <svg {...base(size)} strokeWidth={1.8}>
      <path d="m3.2 8.4 3 3 6.6-7" />
    </svg>
  );
}
export function ChevronIcon({ size = 12 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <path d="m4.5 6.2 3.5 3.6 3.5-3.6" />
    </svg>
  );
}
export function BoltIcon({ size = 12 }: { size?: number }) {
  return (
    <svg {...base(size)} fill="currentColor" stroke="none">
      <path d="M9.2 1.4 3 9h4l-.6 5.6L13 6.8H8.8l.4-5.4Z" />
    </svg>
  );
}
