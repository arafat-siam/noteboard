import type { Stroke } from '../model/types';
import type { Point } from './geometry';

/** Inserts points so no gap between samples is longer than `maxStep` (keeps cuts precise). */
export function densify(points: number[], maxStep: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 2 < points.length + 1; i += 3) {
    const x = points[i]!;
    const y = points[i + 1]!;
    const p = points[i + 2] ?? 0.5;
    if (out.length) {
      const px = out[out.length - 3]!;
      const py = out[out.length - 2]!;
      const pp = out[out.length - 1]!;
      const steps = Math.floor(Math.hypot(x - px, y - py) / maxStep);
      for (let s = 1; s <= steps; s++) {
        const t = s / (steps + 1);
        out.push(px + (x - px) * t, py + (y - py) * t, pp + (p - pp) * t);
      }
    }
    out.push(x, y, p);
  }
  return out;
}

/**
 * Partial ("pixel") eraser: removes the part of a stroke under the eraser circle and returns
 * the pieces that remain, each a new stroke. Returns null if the eraser doesn't touch it.
 */
export function eraseFromStroke(stroke: Stroke, center: Point, radius: number, makeId: () => string): Stroke[] | null {
  const reach = radius + stroke.size * 0.4;
  const reachSq = reach * reach;
  // Quick reject on the raw points' bounding box.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < stroke.points.length; i += 3) {
    minX = Math.min(minX, stroke.points[i]!);
    maxX = Math.max(maxX, stroke.points[i]!);
    minY = Math.min(minY, stroke.points[i + 1]!);
    maxY = Math.max(maxY, stroke.points[i + 1]!);
  }
  if (center.x < minX - reach || center.x > maxX + reach || center.y < minY - reach || center.y > maxY + reach) {
    return null;
  }

  const pts = densify(stroke.points, Math.max(0.6, radius / 4));
  const pieces: number[][] = [];
  let current: number[] = [];
  let touched = false;
  for (let i = 0; i < pts.length; i += 3) {
    const dx = pts[i]! - center.x;
    const dy = pts[i + 1]! - center.y;
    if (dx * dx + dy * dy <= reachSq) {
      touched = true;
      if (current.length) pieces.push(current);
      current = [];
    } else {
      current.push(pts[i]!, pts[i + 1]!, pts[i + 2]!);
    }
  }
  if (current.length) pieces.push(current);
  if (!touched) return null;
  return pieces
    .filter((p) => p.length >= 6) // at least two points
    .map((points) => ({ ...stroke, id: makeId(), points }));
}
