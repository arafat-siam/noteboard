import { boundsOf, distance, distanceToSegment, type Point } from './geometry';

export type ShapeKind = 'line' | 'polyline' | 'circle' | 'ellipse' | 'triangle' | 'rectangle' | 'polygon';

export interface RecognizedShape {
  kind: ShapeKind;
  /** Points along the ideal shape, ready to be drawn as a stroke. */
  points: Point[];
}

/** While the Pencil is held still to trigger snapping it keeps jittering around the tip. */
const HOLD_RADIUS = 6;
const RESAMPLE_STEP = 2;

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

/** Drops the cluster of jitter samples at the end of the stroke (where the Pencil was held). */
function trimHold(points: Point[]): Point[] {
  const last = points[points.length - 1]!;
  let end = points.length - 1;
  while (end > 1 && distance(points[end - 1]!, last) < HOLD_RADIUS) end--;
  return points.slice(0, end + 1);
}

/** Moving-average smoothing (endpoints kept) to remove hand tremor before measuring. */
function smooth(points: Point[], radius = 2): Point[] {
  if (points.length < 2 * radius + 1) return points.slice();
  return points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return p;
    let x = 0;
    let y = 0;
    let n = 0;
    for (let k = -radius; k <= radius; k++) {
      const q = points[i + k];
      if (!q) continue;
      x += q.x;
      y += q.y;
      n++;
    }
    return { x: x / n, y: y / n };
  });
}

/** Evenly spaced points along the path, so measurements don't depend on drawing speed. */
function resample(points: Point[], step: number): Point[] {
  const out: Point[] = [points[0]!];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = distance(a, b);
    let t = step - carry;
    while (t <= seg) {
      out.push({ x: a.x + ((b.x - a.x) * t) / seg, y: a.y + ((b.y - a.y) * t) / seg });
      t += step;
    }
    carry = seg - (t - step);
  }
  const last = points[points.length - 1]!;
  if (distance(out[out.length - 1]!, last) > 0.01) out.push(last);
  return out;
}

function sampleSegment(a: Point, b: Point, step: number): Point[] {
  const n = Math.max(1, Math.ceil(distance(a, b) / step));
  const out: Point[] = [];
  for (let i = 0; i < n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
  return out;
}

function polylinePoints(vertices: Point[], closed: boolean, step = 3): Point[] {
  const out: Point[] = [];
  const count = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < count; i++) out.push(...sampleSegment(vertices[i]!, vertices[(i + 1) % vertices.length]!, step));
  out.push({ ...(closed ? vertices[0]! : vertices[vertices.length - 1]!) });
  return out;
}

/** Interior angle at each vertex of a closed polygon, in degrees. */
function angles(vertices: Point[]): number[] {
  const n = vertices.length;
  return vertices.map((c, i) => {
    const prev = vertices[(i + n - 1) % n]!;
    const next = vertices[(i + 1) % n]!;
    const a1 = Math.atan2(prev.y - c.y, prev.x - c.x);
    const a2 = Math.atan2(next.y - c.y, next.x - c.x);
    let deg = Math.abs(((a1 - a2) * 180) / Math.PI) % 360;
    if (deg > 180) deg = 360 - deg;
    return deg;
  });
}

/** Removes vertices that are too close together or barely bend the outline. */
function cleanCorners(vertices: Point[], minGap: number): Point[] {
  let v = vertices.slice();
  let changed = true;
  while (changed && v.length > 3) {
    changed = false;
    for (let i = 0; i < v.length; i++) {
      const next = v[(i + 1) % v.length]!;
      if (distance(v[i]!, next) < minGap) {
        v.splice((i + 1) % v.length, 1);
        changed = true;
        break;
      }
    }
    if (changed) continue;
    const a = angles(v);
    const flat = a.findIndex((deg) => deg > 160);
    if (flat >= 0) {
      v.splice(flat, 1);
      changed = true;
    }
  }
  return v;
}

interface EllipseFit {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotation: number;
  error: number;
}

/** Fits an (optionally tilted) ellipse using the principal axes of the points. */
function fitEllipse(points: Point[]): EllipseFit | null {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const rotation = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of points) {
    const u = (p.x - mx) * cos + (p.y - my) * sin;
    const v = -(p.x - mx) * sin + (p.y - my) * cos;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const rx = (maxU - minU) / 2;
  const ry = (maxV - minV) / 2;
  if (rx < 4 || ry < 4) return null;
  const cu = (maxU + minU) / 2;
  const cv = (maxV + minV) / 2;
  const cx = mx + cu * cos - cv * sin;
  const cy = my + cu * sin + cv * cos;
  let error = 0;
  for (const p of points) {
    const u = (p.x - cx) * cos + (p.y - cy) * sin;
    const v = -(p.x - cx) * sin + (p.y - cy) * cos;
    error += Math.abs(Math.hypot(u / rx, v / ry) - 1);
  }
  return { cx, cy, rx, ry, rotation, error: error / n };
}

function ellipsePoints(e: EllipseFit, startAt: Point): Point[] {
  const cos = Math.cos(e.rotation);
  const sin = Math.sin(e.rotation);
  // Start where the user started, so the snapped shape feels anchored to the stroke.
  const su = (startAt.x - e.cx) * cos + (startAt.y - e.cy) * sin;
  const sv = -(startAt.x - e.cx) * sin + (startAt.y - e.cy) * cos;
  const start = Math.atan2(sv / e.ry, su / e.rx);
  const steps = Math.max(48, Math.ceil((Math.PI * (e.rx + e.ry)) / 3));
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = start + (i / steps) * Math.PI * 2;
    const u = e.rx * Math.cos(a);
    const v = e.ry * Math.sin(a);
    out.push({ x: e.cx + u * cos - v * sin, y: e.cy + u * sin + v * cos });
  }
  return out;
}

/** Minimum-area-ish box aligned to the shape's own axes (or to the page when nearly level). */
function rectangleFrom(points: Point[], corners: Point[]): Point[] {
  const edge = Math.atan2(corners[1]!.y - corners[0]!.y, corners[1]!.x - corners[0]!.x);
  // Snap the tilt to the nearest right angle when it's within 8 degrees.
  const quarter = Math.PI / 2;
  const nearest = Math.round(edge / quarter) * quarter;
  const rotation = Math.abs(edge - nearest) < (8 * Math.PI) / 180 ? nearest : edge;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of points) {
    const u = p.x * cos + p.y * sin;
    const v = -p.x * sin + p.y * cos;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const toXY = (u: number, v: number) => ({ x: u * cos - v * sin, y: u * sin + v * cos });
  return [toXY(minU, minV), toXY(maxU, minV), toXY(maxU, maxV), toXY(minU, maxV)];
}

/**
 * Recognizes a hand-drawn line, polyline, circle, ellipse, triangle, rectangle or polygon.
 * Returns null when the stroke doesn't look like a clean shape (it stays freehand).
 */
export function recognizeShape(rawPoints: Point[]): RecognizedShape | null {
  if (rawPoints.length < 4) return null;
  const trimmed = trimHold(rawPoints);
  if (trimmed.length < 2) return null;
  const points = resample(smooth(trimmed), RESAMPLE_STEP);
  if (points.length < 4) return null;
  // Straightness is judged on the unsmoothed path, so smoothing can't flatten a scribble into a line.
  const rawPath = resample(trimmed, RESAMPLE_STEP);

  const length = pathLength(points);
  const bounds = boundsOf(points);
  const diagonal = Math.hypot(bounds.width, bounds.height);
  if (length < 18 || diagonal < 12) return null;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const chord = distance(first, last);

  // Straight line: no point strays far from the line between the ends.
  const maxDeviation = Math.max(...rawPath.map((p) => distanceToSegment(p, first, last)));
  if (chord > 0.75 * length && maxDeviation < Math.max(3, 0.045 * chord)) {
    return { kind: 'line', points: polylinePoints([first, last], false) };
  }

  const closed = chord < Math.max(0.22 * diagonal, 14);

  if (!closed) {
    // Open polyline (an "L", a "V", a zig-zag of up to 3 straight segments).
    const vertices = simplify(points, Math.max(3, 0.05 * diagonal));
    const straight = vertices.length >= 3 && vertices.length <= 4;
    if (straight) {
      const worst = Math.max(
        ...rawPath.map((p) => Math.min(...vertices.slice(1).map((v, i) => distanceToSegment(p, vertices[i]!, v)))),
      );
      if (worst < Math.max(3, 0.05 * diagonal)) return { kind: 'polyline', points: polylinePoints(vertices, false) };
    }
    return null;
  }

  // Closed shapes.
  let corners = simplify(points, Math.max(3, 0.07 * diagonal));
  if (corners.length > 1 && distance(corners[0]!, corners[corners.length - 1]!) < 0.25 * diagonal) corners.pop();
  corners = cleanCorners(corners, 0.12 * diagonal);

  const ellipse = fitEllipse(points);

  if (corners.length === 4) {
    const a = angles(corners);
    if (a.every((deg) => Math.abs(deg - 90) < 22)) {
      return { kind: 'rectangle', points: polylinePoints(rectangleFrom(points, corners), true) };
    }
  }
  if (corners.length === 3 && !(ellipse && ellipse.error < 0.05)) {
    return { kind: 'triangle', points: polylinePoints(corners, true) };
  }
  if (ellipse && ellipse.error < 0.11) {
    const round = Math.abs(ellipse.rx - ellipse.ry) / Math.max(ellipse.rx, ellipse.ry) < 0.14;
    if (round) {
      const r = (ellipse.rx + ellipse.ry) / 2;
      return { kind: 'circle', points: ellipsePoints({ ...ellipse, rx: r, ry: r }, first) };
    }
    return { kind: 'ellipse', points: ellipsePoints(ellipse, first) };
  }
  if (corners.length >= 4 && corners.length <= 8) return { kind: 'polygon', points: polylinePoints(corners, true) };
  return null;
}
