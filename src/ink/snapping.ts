import type { Stroke } from '../model/types';
import { distance, distanceToSegment, strokePoints, type Point } from './geometry';
import { simplify } from './shapes';

/**
 * Drawboard-style snapping for straight lines drawn with hold-to-snap.
 *
 * While a snapped line follows the Pencil, its free end is pulled to:
 *  1. points of existing straight ink: ends, midpoints (to bisect a line), corners;
 *  2. otherwise an angle: perpendicular or parallel to a nearby straight line, or a
 *     "straight" angle (0°, 15°, 30°, 45°, … 90°) on the page.
 * The line's start also snaps to points, so lines connect cleanly.
 */

export interface Segment {
  a: Point;
  b: Point;
}

export interface SnapGuides {
  segments: Segment[];
  /** Points of interest: segment ends, midpoints. */
  points: { p: Point; kind: 'end' | 'mid' }[];
}

export type SnapKind = 'end' | 'mid' | 'perpendicular' | 'parallel' | 'angle';

export interface SnapResult {
  point: Point;
  kind: SnapKind;
  /** The existing line the snap relates to (for drawing a guide). */
  segment?: Segment;
  /** Angle snaps: the snapped direction in degrees (0 = right, 90 = down). */
  degrees?: number;
}

/** Straight pieces of the page's ink (lines, polylines, polygon edges). */
export function buildGuides(strokes: Stroke[], ignore?: ReadonlySet<string>): SnapGuides {
  const segments: Segment[] = [];
  for (const s of strokes) {
    if (ignore?.has(s.id) || s.points.length < 6) continue;
    const pts = strokePoints(s);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const diagonal = Math.hypot(maxX - minX, maxY - minY);
    if (diagonal < 16) continue;
    const tolerance = Math.max(1.5, 0.02 * diagonal);
    const vertices = simplify(pts, tolerance);
    // Only clearly straight-edged ink counts (handwriting and curves give many short pieces).
    if (vertices.length > 9) continue;
    for (let i = 1; i < vertices.length; i++) {
      const a = vertices[i - 1]!;
      const b = vertices[i]!;
      if (distance(a, b) >= 12) segments.push({ a, b });
    }
  }
  const points: SnapGuides['points'] = [];
  for (const { a, b } of segments) {
    points.push({ p: a, kind: 'end' }, { p: b, kind: 'end' }, { p: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, kind: 'mid' });
  }
  return { segments, points };
}

/** The nearest point of interest within `radius`, if any. Midpoints win ties with ends. */
export function snapToPoint(p: Point, guides: SnapGuides, radius: number): SnapResult | null {
  let best: SnapResult | null = null;
  let bestDistance = radius;
  for (const poi of guides.points) {
    const d = distance(p, poi.p);
    if (d <= bestDistance) {
      bestDistance = d;
      best = { point: { ...poi.p }, kind: poi.kind };
    }
  }
  return best;
}

const deg = (rad: number) => (rad * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;
/** Difference between two line directions (lines have no arrow: 0° ≡ 180°). */
const lineAngleDiff = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 180) + 180) % 180);
  return Math.min(d, 180 - d);
};

/**
 * Where the free end of a line from `start` towards `end` should land.
 * `radius` is the point-snap distance and `angleTolerance` the angle snap (degrees).
 */
export function snapLineEnd(
  start: Point,
  end: Point,
  guides: SnapGuides,
  radius: number,
  angleTolerance = 4,
): SnapResult | null {
  const length = distance(start, end);
  if (length < radius) return null;

  const point = snapToPoint(end, guides, radius);
  if (point && distance(point.point, start) > radius) return point;

  const current = deg(Math.atan2(end.y - start.y, end.x - start.x));
  type Candidate = { degrees: number; kind: SnapKind; segment?: Segment; priority: number };
  const candidates: Candidate[] = [];
  // Relations to nearby lines matter more than page angles: perpendicular / parallel.
  const near = radius * 6;
  for (const segment of guides.segments) {
    const close =
      distanceToSegment(start, segment.a, segment.b) < near || distanceToSegment(end, segment.a, segment.b) < near;
    if (!close) continue;
    const dir = deg(Math.atan2(segment.b.y - segment.a.y, segment.b.x - segment.a.x));
    // Among lines at the same angle, the one the Pencil is reaching wins.
    const reach = Math.min(1, distanceToSegment(end, segment.a, segment.b) / near) * 0.5;
    candidates.push({ degrees: dir + 90, kind: 'perpendicular', segment, priority: reach });
    candidates.push({ degrees: dir, kind: 'parallel', segment, priority: 1 + reach });
  }
  for (let a = 0; a < 180; a += 15) candidates.push({ degrees: a, kind: 'angle', priority: 2 });

  let best: Candidate | null = null;
  let bestDiff = Infinity;
  for (const c of candidates) {
    const diff = lineAngleDiff(current, c.degrees);
    if (diff > angleTolerance) continue;
    // Prefer relations over plain angles when both are within tolerance.
    const score = diff + c.priority * 0.75;
    if (score < bestDiff) {
      bestDiff = score;
      best = c;
    }
  }
  if (!best) return null;

  // Keep the Pencil's direction (not the opposite one) and its distance along that direction.
  let direction = best.degrees;
  if (Math.cos(rad(current - direction)) < 0) direction += 180;
  const ux = Math.cos(rad(direction));
  const uy = Math.sin(rad(direction));
  const along = (end.x - start.x) * ux + (end.y - start.y) * uy;
  let snapped = { x: start.x + ux * along, y: start.y + uy * along };

  // Perpendicular to a line it reaches: end exactly on that line (the foot of the perpendicular).
  if (best.kind === 'perpendicular' && best.segment) {
    const foot = intersect(start, snapped, best.segment);
    if (foot && distance(foot, snapped) < radius * 1.5) snapped = foot;
  }
  return { point: snapped, kind: best.kind, segment: best.segment, degrees: ((direction % 360) + 360) % 360 };
}

/** Where the infinite line through p→q crosses the segment's line (null if parallel). */
function intersect(p: Point, q: Point, s: Segment): Point | null {
  const d1x = q.x - p.x;
  const d1y = q.y - p.y;
  const d2x = s.b.x - s.a.x;
  const d2y = s.b.y - s.a.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((s.a.x - p.x) * d2y - (s.a.y - p.y) * d2x) / den;
  return { x: p.x + d1x * t, y: p.y + d1y * t };
}

/** Same snap target as before? (So the Pencil only buzzes when it moves onto a new one.) */
export function sameSnap(a: SnapResult | null, b: SnapResult | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind || a.segment !== b.segment) return false;
  if (a.kind === 'end' || a.kind === 'mid') return distance(a.point, b.point) < 0.5;
  return Math.abs((a.degrees ?? 0) - (b.degrees ?? 0)) < 0.5;
}
