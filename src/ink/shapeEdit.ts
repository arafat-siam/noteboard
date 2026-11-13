import type { Stroke } from '../model/types';
import { distance, distanceToSegment, strokePoints, type Point } from './geometry';
import { polylinePoints, simplify } from './shapes';

/**
 * Editing straight-edged shapes by their points, like Drawboard: a line has 2 end points, a
 * rectangle its 4 corners, a triangle / polygon one point per corner.
 */
export interface ShapeVertices {
  vertices: Point[];
  closed: boolean;
  /** 4 corners at right angles: dragging a corner keeps it a rectangle. */
  rectangle: boolean;
}

/** The corners of a straight-edged shape, or null for freehand ink, curves and pictures. */
export function shapeVertices(stroke: Stroke): ShapeVertices | null {
  if (stroke.tool === 'image' || stroke.tool === 'text' || stroke.points.length < 6) return null;
  const pts = strokePoints(stroke);
  let vertices = simplify(pts, 0.75);
  if (vertices.length < 2 || vertices.length > 13) return null;
  // Every point must lie on the straight edges (true for snapped shapes, not handwriting).
  for (const p of pts) {
    let best = Infinity;
    for (let i = 1; i < vertices.length; i++) best = Math.min(best, distanceToSegment(p, vertices[i - 1]!, vertices[i]!));
    if (best > 0.9) return null;
  }
  const closed = vertices.length >= 4 && distance(vertices[0]!, vertices[vertices.length - 1]!) < 1;
  if (closed) vertices = vertices.slice(0, -1);
  vertices = dropStraightPoints(vertices, closed);
  if (vertices.length > 12) return null;
  // Too short to edit by its points.
  const span = Math.max(...vertices.map((v) => distance(v, vertices[0]!)));
  if (span < 8) return null;
  return { vertices, closed, rectangle: closed && vertices.length === 4 && rightAngles(vertices) };
}

/** Removes points in the middle of a straight edge (they're not corners). */
function dropStraightPoints(v: Point[], closed: boolean): Point[] {
  const out = v.slice();
  let changed = true;
  while (changed && out.length > (closed ? 3 : 2)) {
    changed = false;
    for (let i = closed ? 0 : 1; i < (closed ? out.length : out.length - 1); i++) {
      const prev = out[(i - 1 + out.length) % out.length]!;
      const next = out[(i + 1) % out.length]!;
      if (distanceToSegment(out[i]!, prev, next) < 0.75) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

function rightAngles(v: Point[]): boolean {
  return v.every((p, i) => {
    const a = v[(i + 3) % 4]!;
    const b = v[(i + 1) % 4]!;
    const ux = a.x - p.x;
    const uy = a.y - p.y;
    const wx = b.x - p.x;
    const wy = b.y - p.y;
    const cos = (ux * wx + uy * wy) / (Math.hypot(ux, uy) * Math.hypot(wx, wy) || 1);
    return Math.abs(cos) < 0.05; // within ~3° of square
  });
}

/**
 * Shape points after dragging point `index` to `to`. Rectangles stay rectangles (the opposite
 * corner stays put, sides keep their direction); other shapes just move that point.
 */
export function dragVertex(shape: ShapeVertices, index: number, to: Point): Point[] {
  const v = shape.vertices;
  if (!shape.rectangle) return v.map((p, i) => (i === index ? { ...to } : { ...p }));
  const o = (index + 2) % 4;
  const n1 = (o + 1) % 4;
  const n3 = (o + 3) % 4;
  const a = v[o]!;
  const unit = (p: Point) => {
    const len = Math.hypot(p.x - a.x, p.y - a.y) || 1;
    return { x: (p.x - a.x) / len, y: (p.y - a.y) / len };
  };
  const e1 = unit(v[n1]!);
  const e2 = unit(v[n3]!);
  const dx = to.x - a.x;
  const dy = to.y - a.y;
  const l1 = dx * e1.x + dy * e1.y;
  const l2 = dx * e2.x + dy * e2.y;
  const out = v.map((p) => ({ ...p }));
  out[n1] = { x: a.x + e1.x * l1, y: a.y + e1.y * l1 };
  out[n3] = { x: a.x + e2.x * l2, y: a.y + e2.y * l2 };
  out[index] = { x: a.x + e1.x * l1 + e2.x * l2, y: a.y + e1.y * l1 + e2.y * l2 };
  return out;
}

/** The stroke redrawn through new shape points (same pen, colour, fill and layer). */
export function strokeThrough(stroke: Stroke, vertices: Point[], closed: boolean, id: string): Stroke {
  let pressure = 0;
  let n = 0;
  for (let i = 2; i < stroke.points.length; i += 3) {
    pressure += stroke.points[i]!;
    n++;
  }
  const pr = n ? pressure / n : 0.5;
  const pts = polylinePoints(vertices, closed);
  return { ...stroke, id, points: pts.flatMap((p) => [p.x, p.y, pr]) };
}
