import { boundsOf, distance, distanceToSegment, type Point } from './geometry';

export type ShapeKind = 'line' | 'circle' | 'ellipse' | 'triangle' | 'rectangle' | 'polygon';

export interface RecognizedShape {
  kind: ShapeKind;
  /** Points along the ideal shape, ready to be drawn as a stroke. */
  points: Point[];
}

function pathLength(points: Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += distance(points[i - 1]!, points[i]!);
  return length;
}

/** Ramer–Douglas–Peucker polyline simplification. */
export function simplify(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice();
  let maxDist = 0;
  let index = 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= epsilon) return [first, last];
  const left = simplify(points.slice(0, index + 1), epsilon);
  const right = simplify(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

function sampleSegment(a: Point, b: Point, step: number): Point[] {
  const n = Math.max(1, Math.ceil(distance(a, b) / step));
  const out: Point[] = [];
  for (let i = 0; i < n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
  return out;
}

function polygonPoints(corners: Point[], step = 4): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < corners.length; i++) out.push(...sampleSegment(corners[i]!, corners[(i + 1) % corners.length]!, step));
  out.push({ ...corners[0]! });
  return out;
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number, startAngle: number): Point[] {
  const steps = Math.max(36, Math.ceil((Math.PI * (rx + ry)) / 4));
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = startAngle + (i / steps) * Math.PI * 2;
    out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return out;
}

/**
 * Recognizes a hand-drawn line, circle, ellipse, triangle, rectangle or polygon.
 * Returns null when the stroke doesn't look like a clean shape (it stays freehand).
 */
export function recognizeShape(points: Point[]): RecognizedShape | null {
  if (points.length < 4) return null;
  const length = pathLength(points);
  const bounds = boundsOf(points);
  const diagonal = Math.hypot(bounds.width, bounds.height);
  if (length < 20 || diagonal < 15) return null;

  const first = points[0]!;
  const last = points[points.length - 1]!;

  // Straight line: the ends are almost as far apart as the path is long.
  if (distance(first, last) / length > 0.92) {
    return { kind: 'line', points: sampleSegment(first, last, 4).concat({ ...last }) };
  }

  // Everything else must be a closed loop.
  if (distance(first, last) > Math.max(0.2 * diagonal, 12)) return null;

  const corners = simplify(points, Math.max(0.07 * diagonal, 4));
  // Drop the closing point if it duplicates the start.
  if (corners.length > 1 && distance(corners[0]!, corners[corners.length - 1]!) < 0.2 * diagonal) corners.pop();

  if (corners.length === 3) return { kind: 'triangle', points: polygonPoints(corners) };

  if (corners.length === 4) {
    const angles = corners.map((c, i) => {
      const prev = corners[(i + 3) % 4]!;
      const next = corners[(i + 1) % 4]!;
      const a1 = Math.atan2(prev.y - c.y, prev.x - c.x);
      const a2 = Math.atan2(next.y - c.y, next.x - c.x);
      let deg = Math.abs(((a1 - a2) * 180) / Math.PI) % 360;
      if (deg > 180) deg = 360 - deg;
      return deg;
    });
    const rightAngled = angles.every((a) => Math.abs(a - 90) < 20);
    if (rightAngled) {
      const { x, y, width, height } = boundsOf(corners);
      const edgeAngle = Math.atan2(corners[1]!.y - corners[0]!.y, corners[1]!.x - corners[0]!.x);
      const tilt = Math.abs(Math.sin(2 * edgeAngle));
      // Nearly axis-aligned: snap to a clean upright rectangle.
      if (tilt < 0.25) {
        return {
          kind: 'rectangle',
          points: polygonPoints([
            { x, y },
            { x: x + width, y },
            { x: x + width, y: y + height },
            { x, y: y + height },
          ]),
        };
      }
      return { kind: 'rectangle', points: polygonPoints(corners) };
    }
    return { kind: 'polygon', points: polygonPoints(corners) };
  }

  // Ellipse / circle: points should sit on the ellipse defined by the bounding box.
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const rx = bounds.width / 2;
  const ry = bounds.height / 2;
  if (rx < 5 || ry < 5) return null;
  const error =
    points.reduce((sum, p) => sum + Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1), 0) / points.length;
  if (error < 0.13) {
    const startAngle = Math.atan2(first.y - cy, first.x - cx);
    if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.15) {
      const r = (rx + ry) / 2;
      return { kind: 'circle', points: ellipsePoints(cx, cy, r, r, startAngle) };
    }
    return { kind: 'ellipse', points: ellipsePoints(cx, cy, rx, ry, startAngle) };
  }

  if (corners.length >= 5 && corners.length <= 8) return { kind: 'polygon', points: polygonPoints(corners) };
  return null;
}
