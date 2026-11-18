import { forwardRef, memo, useImperativeHandle, useRef } from "react";
import { branchDownPath, branchUpPath, dispatchPath, resultPath, type Geometry } from "./geometry";
import type { LaneStatus } from "./types";

export interface ConnectorsHandle {
  pulse: (lane: number, dir: "down" | "up") => void;
}

export interface ConnectorLane {
  status: LaneStatus;
}

const PULSE_MS = 440;
const colorVar = (i: number) => `var(--s${(i % 4) + 1})`;

interface Props {
  geometry: Geometry | null;
  lanes: ConnectorLane[];
  reduced: boolean;
  leadActive: boolean;
  summaryActive: boolean;
}

const ACTIVE: LaneStatus[] = ["starting", "running", "failed", "returned", "gaveup"];

export const Connectors = memo(
  forwardRef<ConnectorsHandle, Props>(function Connectors({ geometry: g, lanes, reduced, leadActive, summaryActive }, ref) {
    const pulses = useRef<SVGGElement>(null);
    const geo = useRef<Geometry | null>(g);
    geo.current = g;

    useImperativeHandle(
      ref,
      () => ({
        pulse(lane, dir) {
          const layer = pulses.current;
          const gg = geo.current;
          if (reduced || !layer || !gg || !gg.lanes[lane]) return;
          const d = dir === "down" ? dispatchPath(gg, lane) : resultPath(gg, lane);
          if (!d) return;
          const NS = "http://www.w3.org/2000/svg";
          const path = document.createElementNS(NS, "path");
          path.setAttribute("d", d);
          path.setAttribute("pathLength", "1");
          path.setAttribute("fill", "none");
          path.setAttribute("stroke", colorVar(lane));
          path.setAttribute("stroke-width", "3");
          path.setAttribute("stroke-linecap", "round");
          path.setAttribute("stroke-dasharray", "0.07 2");
          path.setAttribute("stroke-dashoffset", "0.07");
          path.style.filter = `drop-shadow(0 0 3px ${colorVar(lane)})`;
          layer.appendChild(path);
          const anim = path.animate([{ strokeDashoffset: 0.07 }, { strokeDashoffset: -1 }], {
            duration: PULSE_MS,
            easing: "cubic-bezier(0.45, 0, 0.25, 1)",
            fill: "forwards",
          });
          const cleanup = () => path.remove();
          anim.onfinish = cleanup;
          anim.oncancel = cleanup;
        },
      }),
      [reduced],
    );

    if (!g || g.lanes.length === 0) return <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />;

    const stack = g.mode === "stack";
    const minTop = Math.min(...g.lanes.map(l => l.top));
    const maxBottom = Math.max(...g.lanes.map(l => l.bottom));
    const y1 = g.leadBottom + (minTop - g.leadBottom) / 2;
    const y2 = maxBottom + (g.sumTop - maxBottom) / 2;

    const anyActive = lanes.some(l => ACTIVE.includes(l.status));
    const anyReturned = lanes.some(l => l.status === "returned");

    return (
      <svg
        aria-hidden="true"
        focusable="false"
        className="pointer-events-none absolute inset-0 z-20 overflow-visible"
        width={g.w}
        height={g.h}
        viewBox={`0 0 ${g.w} ${g.h}`}
      >
        {/* base wires */}
        <g fill="none" strokeLinecap="round" strokeWidth={1.5} style={{ stroke: "var(--wire)" }}>
          {stack ? (
            <path d={`M${g.leadX} ${g.leadBottom}V${g.sumTop}`} />
          ) : (
            <>
              <path d={`M${g.leadX} ${g.leadBottom}V${y1}`} />
              <path d={`M${g.sumX} ${y2}V${g.sumTop}`} />
            </>
          )}
          {g.lanes.map((_, i) => {
            const st = lanes[i]?.status ?? "waiting";
            if (st === "waiting") return null;
            const queued = st === "queued";
            return (
              <g key={i}>
                <path d={branchDownPath(g, i)} strokeDasharray={queued ? "3 4" : undefined} />
                {!stack && <path d={branchUpPath(g, i)} strokeDasharray={st === "planned" || queued ? "3 4" : undefined} />}
              </g>
            );
          })}
        </g>

        {/* series-colored wires: work has reached the lane */}
        <g fill="none" strokeLinecap="round" strokeWidth={1.75}>
          {g.lanes.map((_, i) => {
            const st = lanes[i]?.status ?? "waiting";
            const on = ACTIVE.includes(st);
            const back = st === "returned";
            return (
              <g key={i} style={{ stroke: st === "gaveup" ? "var(--danger)" : colorVar(i) }}>
                <path
                  d={branchDownPath(g, i)}
                  style={{ opacity: on ? 1 : 0, transition: "opacity 260ms ease-out 120ms" }}
                />
                {!stack && (
                  <path
                    d={branchUpPath(g, i)}
                    style={{ opacity: back ? 1 : 0, transition: "opacity 260ms ease-out" }}
                  />
                )}
              </g>
            );
          })}
        </g>

        {/* the trunk takes the lead's tone once anything is out */}
        {anyActive && (
          <g fill="none" strokeLinecap="round" strokeWidth={1.75} style={{ stroke: "var(--fg3)", opacity: 0.55 }}>
            {stack ? (
              <path d={`M${g.leadX} ${g.leadBottom}V${Math.max(...g.lanes.filter((_, i) => ACTIVE.includes(lanes[i]?.status)).map(l => l.cy), g.leadBottom)}`} />
            ) : (
              <path d={`M${g.leadX} ${g.leadBottom}V${y1}`} />
            )}
            {!stack && anyReturned && <path d={`M${g.sumX} ${y2}V${g.sumTop}`} />}
          </g>
        )}

        {/* ports */}
        <g strokeWidth={1.5}>
          <Port x={g.leadX} y={g.leadBottom} filled={leadActive} color="var(--fg2)" />
          {!stack && <Port x={g.sumX} y={g.sumTop} filled={summaryActive} color="var(--fg2)" />}
          {stack && <Port x={g.leadX} y={g.sumTop} filled={summaryActive} color="var(--fg2)" />}
          {g.lanes.map((l, i) => {
            const st = lanes[i]?.status ?? "waiting";
            if (st === "waiting") return null;
            const filled = ACTIVE.includes(st);
            const c = st === "gaveup" ? "var(--danger)" : colorVar(i);
            return stack ? (
              <Port key={i} x={l.left} y={l.cy} filled={filled} color={c} />
            ) : (
              <g key={i}>
                <Port x={l.x} y={l.top} filled={filled} color={c} />
                <Port x={l.x} y={l.bottom} filled={st === "returned"} color={c} />
              </g>
            );
          })}
        </g>

        {/* pulses are appended here imperatively */}
        <g ref={pulses} />
      </svg>
    );
  }),
);

function Port({ x, y, filled, color }: { x: number; y: number; filled: boolean; color: string }) {
  return (
    <circle
      cx={x}
      cy={y}
      r={3.5}
      style={{
        fill: filled ? color : "var(--card)",
        stroke: filled ? color : "var(--wire)",
        transition: "fill 240ms ease-out, stroke 240ms ease-out",
      }}
    />
  );
}
