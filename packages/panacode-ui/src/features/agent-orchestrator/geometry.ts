export type Pt = [number, number]

export interface LaneBox {
  x: number
  top: number
  bottom: number
  left: number
  cy: number
}

export interface Geometry {
  mode: "wide" | "stack"
  w: number
  h: number
  leadX: number
  leadBottom: number
  sumX: number
  sumTop: number
  lanes: LaneBox[]
}

/** Polyline with rounded corners (Arc orchestrator geometry). */
export function rounded(points: Pt[], r = 10): string {
  const pts = points.filter((p, i) => i === 0 || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1])
  if (pts.length < 2) return ""
  let d = `M${pts[0]![0]} ${pts[0]![1]}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]!
    const [cx, cy] = pts[i]!
    const [nx, ny] = pts[i + 1]!
    const d1 = Math.hypot(cx - px, cy - py)
    const d2 = Math.hypot(nx - cx, ny - cy)
    const rr = Math.min(r, d1 / 2, d2 / 2)
    const ax = cx - ((cx - px) / d1) * rr
    const ay = cy - ((cy - py) / d1) * rr
    const bx = cx + ((nx - cx) / d2) * rr
    const by = cy + ((ny - cy) / d2) * rr
    d += `L${ax} ${ay}Q${cx} ${cy} ${bx} ${by}`
  }
  const last = pts[pts.length - 1]!
  return d + `L${last[0]} ${last[1]}`
}

export const busY1 = (g: Geometry) => {
  const minTop = Math.min(...g.lanes.map((l) => l.top))
  return g.leadBottom + (minTop - g.leadBottom) / 2
}
export const busY2 = (g: Geometry) => {
  const maxBottom = Math.max(...g.lanes.map((l) => l.bottom))
  return maxBottom + (g.sumTop - maxBottom) / 2
}

export function branchDownPath(g: Geometry, i: number): string {
  const l = g.lanes[i]
  if (!l) return ""
  if (g.mode === "wide") {
    const y = busY1(g)
    return rounded([
      [g.leadX, y],
      [l.x, y],
      [l.x, l.top],
    ])
  }
  return rounded([
    [g.leadX, l.cy],
    [l.left, l.cy],
  ])
}

export function branchUpPath(g: Geometry, i: number): string {
  const l = g.lanes[i]
  if (!l || g.mode !== "wide") return ""
  const y = busY2(g)
  return rounded([
    [l.x, l.bottom],
    [l.x, y],
    [g.sumX, y],
  ])
}
