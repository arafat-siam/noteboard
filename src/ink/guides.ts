import type { Point } from './geometry';

/**
 * Ruler and protractor (like Apple Notes): drawing aids laid over the screen, never saved.
 * Positions are in screen (client) pixels, so they stay put while the page scrolls under them.
 * Ink drawn along the ruler's edge becomes perfectly straight; ink drawn along the protractor's
 * arc follows the circle.
 */
export interface RulerGuide {
  kind: 'ruler';
  /** Centre of the ruler (client px). */
  cx: number;
  cy: number;
  /** Radians, 0 = horizontal. */
  angle: number;
  length: number;
  /** Thickness (client px). */
  width: number;
}

export interface ProtractorGuide {
  kind: 'protractor';
  /** Centre of the baseline (client px). */
  cx: number;
  cy: number;
  angle: number;
  radius: number;
}

export type Guide = RulerGuide | ProtractorGuide;

let current: Guide | null = null;
const listeners = new Set<() => void>();

export function getGuide(): Guide | null {
  return current;
}

export function setGuide(guide: Guide | null): void {
  current = guide;
  for (const l of listeners) l();
}

export function onGuideChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How close (client px) the Pencil must start to an edge for the stroke to follow it. */
export const GUIDE_REACH = 28;

/** Angles snap to every 15° when within this many degrees. */
const SNAP_DEG = 2.5;
export function snapAngle(angle: number): number {
  const step = Math.PI / 12;
  const snapped = Math.round(angle / step) * step;
  return Math.abs(angle - snapped) < (SNAP_DEG * Math.PI) / 180 ? snapped : angle;
}

/** Shown angle in degrees, 0–180 (a ruler at 190° is the same line as at 10°). */
export function displayDegrees(angle: number): number {
  const deg = ((((angle * 180) / Math.PI) % 180) + 180) % 180;
  return Math.round(deg * 10) / 10;
}

/** The ruler's two long edges as lines (client px): point on the line + unit direction + outward normal. */
export function rulerEdges(r: RulerGuide): { a: Point; dir: Point; normal: Point }[] {
  const dir = { x: Math.cos(r.angle), y: Math.sin(r.angle) };
  const n = { x: -dir.y, y: dir.x };
  const h = r.width / 2;
  return [
    { a: { x: r.cx + n.x * h, y: r.cy + n.y * h }, dir, normal: n },
    { a: { x: r.cx - n.x * h, y: r.cy - n.y * h }, dir, normal: { x: -n.x, y: -n.y } },
  ];
}

/**
 * If `p` (client px) is near the guide, the edge the stroke should follow: a straight line or a
 * circle. Returns null when the Pencil isn't near an edge.
 */
export type GuideEdge = { kind: 'line'; a: Point; dir: Point; normal: Point } | { kind: 'arc'; c: Point; r: number };

export function edgeNear(guide: Guide, p: Point, reach = GUIDE_REACH): GuideEdge | null {
  if (guide.kind === 'ruler') {
    const half = guide.length / 2;
    let best: GuideEdge | null = null;
    let bestD = reach;
    for (const e of rulerEdges(guide)) {
      const dx = p.x - e.a.x;
      const dy = p.y - e.a.y;
      const along = dx * e.dir.x + dy * e.dir.y;
      const off = dx * e.normal.x + dy * e.normal.y; // > 0 = outside the ruler
      if (Math.abs(along) > half + reach || off < -4) continue;
      if (Math.abs(off) < bestD) {
        bestD = Math.abs(off);
        best = { kind: 'line', ...e };
      }
    }
    return best;
  }
  const d = Math.hypot(p.x - guide.cx, p.y - guide.cy);
  return Math.abs(d - guide.radius) <= reach && d > guide.radius - 6 ? { kind: 'arc', c: { x: guide.cx, y: guide.cy }, r: guide.radius } : null;
}

/** The point on the edge (client px), pushed out by `inset` so the ink sits against it, not under it. */
export function projectOnEdge(edge: GuideEdge, p: Point, inset = 0): Point {
  if (edge.kind === 'line') {
    const t = (p.x - edge.a.x) * edge.dir.x + (p.y - edge.a.y) * edge.dir.y;
    return { x: edge.a.x + edge.dir.x * t + edge.normal.x * inset, y: edge.a.y + edge.dir.y * t + edge.normal.y * inset };
  }
  const dx = p.x - edge.c.x;
  const dy = p.y - edge.c.y;
  const len = Math.hypot(dx, dy) || 1;
  const r = edge.r + inset;
  return { x: edge.c.x + (dx / len) * r, y: edge.c.y + (dy / len) * r };
}

/** Angle (degrees, 0–180) of a point around the protractor, measured from its baseline. */
export function protractorDegrees(g: ProtractorGuide, p: Point): number {
  const a = Math.atan2(p.y - g.cy, p.x - g.cx) - g.angle;
  let deg = (-a * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  return Math.round(Math.min(deg, 360 - deg) * 10) / 10;
}
