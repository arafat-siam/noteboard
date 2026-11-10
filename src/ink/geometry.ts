import type { Stroke } from '../model/types';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function strokePoints(stroke: Stroke): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < stroke.points.length; i += 3) {
    out.push({ x: stroke.points[i]!, y: stroke.points[i + 1]! });
  }
  return out;
}

export function boundsOf(points: Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function strokeBounds(stroke: Stroke): Rect {
  const b = boundsOf(strokePoints(stroke));
  const pad = stroke.size;
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** True if the eraser circle at `p` touches the stroke. */
export function strokeHit(stroke: Stroke, p: Point, radius: number): boolean {
  const reach = radius + stroke.size / 2;
  const b = strokeBounds(stroke);
  if (p.x < b.x - reach || p.x > b.x + b.width + reach || p.y < b.y - reach || p.y > b.y + b.height + reach) {
    return false;
  }
  const pts = strokePoints(stroke);
  if (pts.length === 1) return distance(p, pts[0]!) <= reach;
  for (let i = 1; i < pts.length; i++) {
    if (distanceToSegment(p, pts[i - 1]!, pts[i]!) <= reach) return true;
  }
  return false;
}

export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Lasso selection: a stroke is selected when most of its points are inside the loop. */
export function strokeInLasso(stroke: Stroke, lasso: Point[]): boolean {
  if (lasso.length < 3) return false;
  const pts = strokePoints(stroke);
  if (!pts.length) return false;
  const inside = pts.filter((p) => pointInPolygon(p, lasso)).length;
  return inside / pts.length >= 0.6;
}

export function translateStroke(stroke: Stroke, dx: number, dy: number, id: string): Stroke {
  const points = stroke.points.slice();
  for (let i = 0; i + 1 < points.length; i += 3) {
    points[i] = points[i]! + dx;
    points[i + 1] = points[i + 1]! + dy;
  }
  return { ...stroke, id, points, createdAt: Date.now() };
}

/** Scales a stroke about `anchor` (line width scales too, like resizing a drawing). */
export function scaleStroke(stroke: Stroke, anchor: Point, factor: number, id: string): Stroke {
  const points = stroke.points.slice();
  for (let i = 0; i + 1 < points.length; i += 3) {
    points[i] = anchor.x + (points[i]! - anchor.x) * factor;
    points[i + 1] = anchor.y + (points[i + 1]! - anchor.y) * factor;
  }
  return { ...stroke, id, points, size: Math.max(0.3, stroke.size * factor) };
}

/** Same stroke in a new colour (keeps its stacking order). */
export function recolorStroke(stroke: Stroke, color: string, id: string): Stroke {
  return { ...stroke, id, color };
}

/** Rotates a stroke about `center` by `angle` radians. */
export function rotateStroke(stroke: Stroke, center: Point, angle: number, id: string): Stroke {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const points = stroke.points.slice();
  for (let i = 0; i + 1 < points.length; i += 3) {
    const dx = points[i]! - center.x;
    const dy = points[i + 1]! - center.y;
    points[i] = center.x + dx * cos - dy * sin;
    points[i + 1] = center.y + dx * sin + dy * cos;
  }
  return { ...stroke, id, points };
}
