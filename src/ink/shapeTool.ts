import { newId, type DashStyle, type Stroke } from '../model/types';
import type { Point } from './geometry';
import { polylinePoints } from './shapes';

/**
 * The Shapes tool: drag from one corner to the other to draw a perfect shape. Shapes are plain
 * strokes (dense points along their outline), so selecting, moving, resizing, rotating, editing
 * points, filling, recolouring, layering, undo and sync all work unchanged.
 */
export type ShapeToolKind =
  | 'line'
  | 'arrow'
  | 'doubleArrow'
  | 'rectangle'
  | 'roundedRect'
  | 'ellipse'
  | 'triangle'
  | 'rightTriangle'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'star'
  | 'parallelogram';

export const SHAPE_TOOLS: { kind: ShapeToolKind; label: string }[] = [
  { kind: 'line', label: 'Line' },
  { kind: 'arrow', label: 'Arrow' },
  { kind: 'doubleArrow', label: 'Double arrow' },
  { kind: 'rectangle', label: 'Rectangle' },
  { kind: 'roundedRect', label: 'Rounded rectangle' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'rightTriangle', label: 'Right triangle' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'parallelogram', label: 'Parallelogram' },
  { kind: 'pentagon', label: 'Pentagon' },
  { kind: 'hexagon', label: 'Hexagon' },
  { kind: 'star', label: 'Star' },
];

export const isLineShape = (k: ShapeToolKind) => k === 'line' || k === 'arrow' || k === 'doubleArrow';

/**
 * Outline points of a shape dragged from a to b. Box shapes snap to equal width and height when
 * the drag is nearly square (perfect circles and squares), lines snap to every 15°.
 */
export function shapeOutline(kind: ShapeToolKind, a: Point, b: Point): { vertices: Point[]; closed: boolean } {
  if (isLineShape(kind)) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const step = Math.PI / 12;
    const snapped = Math.round(angle / step) * step;
    const end = Math.abs(angle - snapped) < (2.5 * Math.PI) / 180 ? { x: a.x + Math.cos(snapped) * len, y: a.y + Math.sin(snapped) * len } : b;
    return { vertices: [a, end], closed: false };
  }
  let w = b.x - a.x;
  let h = b.y - a.y;
  if (Math.abs(Math.abs(w) - Math.abs(h)) < Math.max(Math.abs(w), Math.abs(h)) * 0.08) {
    const s = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * s;
    h = Math.sign(h || 1) * s;
  }
  const x0 = Math.min(a.x, a.x + w);
  const y0 = Math.min(a.y, a.y + h);
  const W = Math.abs(w);
  const H = Math.abs(h);
  const cx = x0 + W / 2;
  const cy = y0 + H / 2;
  const P = (x: number, y: number) => ({ x, y });
  const regular = (n: number, rotate = -Math.PI / 2, inner?: number) => {
    const pts: Point[] = [];
    const count = inner ? n * 2 : n;
    for (let i = 0; i < count; i++) {
      const t = rotate + (i * Math.PI * 2) / count;
      const r = inner && i % 2 ? inner : 1;
      pts.push(P(cx + (Math.cos(t) * r * W) / 2, cy + (Math.sin(t) * r * H) / 2));
    }
    // Fit the shape's own extent to the dragged box (a pentagon isn't as tall as its circle).
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const sx = W / (maxX - minX || 1);
    const sy = H / (maxY - minY || 1);
    return pts.map((p) => P(x0 + (p.x - minX) * sx, y0 + (p.y - minY) * sy));
  };
  switch (kind) {
    case 'rectangle':
      return { vertices: [P(x0, y0), P(x0 + W, y0), P(x0 + W, y0 + H), P(x0, y0 + H)], closed: true };
    case 'roundedRect': {
      const r = Math.min(W, H) * 0.18;
      const pts: Point[] = [];
      const corner = (cxr: number, cyr: number, start: number) => {
        for (let i = 0; i <= 8; i++) {
          const t = start + (i * Math.PI) / 2 / 8;
          pts.push(P(cxr + Math.cos(t) * r, cyr + Math.sin(t) * r));
        }
      };
      corner(x0 + W - r, y0 + r, -Math.PI / 2);
      corner(x0 + W - r, y0 + H - r, 0);
      corner(x0 + r, y0 + H - r, Math.PI / 2);
      corner(x0 + r, y0 + r, Math.PI);
      return { vertices: pts, closed: true };
    }
    case 'ellipse': {
      const pts: Point[] = [];
      const n = 96;
      for (let i = 0; i < n; i++) {
        const t = (i * Math.PI * 2) / n;
        pts.push(P(cx + (Math.cos(t) * W) / 2, cy + (Math.sin(t) * H) / 2));
      }
      return { vertices: pts, closed: true };
    }
    case 'triangle':
      return { vertices: [P(cx, y0), P(x0 + W, y0 + H), P(x0, y0 + H)], closed: true };
    case 'rightTriangle':
      return { vertices: [P(x0, y0), P(x0 + W, y0 + H), P(x0, y0 + H)], closed: true };
    case 'diamond':
      return { vertices: [P(cx, y0), P(x0 + W, cy), P(cx, y0 + H), P(x0, cy)], closed: true };
    case 'parallelogram': {
      const k = W * 0.22;
      return { vertices: [P(x0 + k, y0), P(x0 + W, y0), P(x0 + W - k, y0 + H), P(x0, y0 + H)], closed: true };
    }
    case 'pentagon':
      return { vertices: regular(5), closed: true };
    case 'hexagon':
      return { vertices: regular(6, 0), closed: true };
    case 'star':
      return { vertices: regular(5, -Math.PI / 2, 0.42), closed: true };
    default:
      return { vertices: [a, b], closed: false };
  }
}

export interface ShapeStyle {
  color: string;
  size: number;
  dash: DashStyle | null;
  fill: string | null;
  fillOpacity: number;
}

/** A finished shape stroke. */
export function makeShapeStroke(kind: ShapeToolKind, a: Point, b: Point, style: ShapeStyle, id = newId()): Stroke {
  const { vertices, closed } = shapeOutline(kind, a, b);
  const pts = polylinePoints(vertices, closed);
  const stroke: Stroke = {
    id,
    tool: 'pen',
    brush: 'fineliner',
    color: style.color,
    size: style.size,
    hasPressure: true,
    points: pts.flatMap((p) => [p.x, p.y, 0.5]),
    createdAt: Date.now(),
  };
  if (style.dash) stroke.dash = style.dash;
  if (kind === 'arrow' || kind === 'doubleArrow') stroke.arrowEnd = true;
  if (kind === 'doubleArrow') stroke.arrowStart = true;
  if (closed && style.fill) {
    stroke.fill = style.fill;
    stroke.fillOpacity = style.fillOpacity;
  }
  return stroke;
}

// ---- Geometry shared by the screen and PDF export (plain SVG path data: M / L / Z only) -----

const f = (v: number) => (Math.round(v * 100) / 100).toString();

function centreLine(stroke: Pick<Stroke, 'points'>): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < stroke.points.length; i += 3) out.push({ x: stroke.points[i]!, y: stroke.points[i + 1]! });
  return out;
}

function quad(p: Point, q: Point, hw: number): string {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * hw;
  const ny = (dx / len) * hw;
  return `M${f(p.x + nx)},${f(p.y + ny)} L${f(q.x + nx)},${f(q.y + ny)} L${f(q.x - nx)},${f(q.y - ny)} L${f(p.x - nx)},${f(p.y - ny)} Z`;
}

function dot(c: Point, r: number): string {
  let d = '';
  const n = 12;
  for (let i = 0; i < n; i++) {
    const t = (i * Math.PI * 2) / n;
    d += `${i ? ' L' : 'M'}${f(c.x + Math.cos(t) * r)},${f(c.y + Math.sin(t) * r)}`;
  }
  return `${d} Z`;
}

export function dashLengths(dash: DashStyle, size: number): { on: number; off: number } {
  return dash === 'dotted' ? { on: 0, off: Math.max(size * 2.2, 2.5) } : { on: Math.max(size * 3.2, 4), off: Math.max(size * 2.2, 3) };
}

/** A dashed or dotted line as filled pieces (SVG path data). */
export function dashPath(stroke: Pick<Stroke, 'points' | 'size' | 'dash'>): string {
  const pts = centreLine(stroke);
  if (pts.length < 2 || !stroke.dash) return '';
  const hw = Math.max(0.3, stroke.size / 2);
  const { on, off } = dashLengths(stroke.dash, stroke.size);
  const parts: string[] = [];
  if (stroke.dash === 'dotted') {
    let next = 0;
    let walked = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      while (next <= walked + len) {
        const t = len ? (next - walked) / len : 0;
        parts.push(dot({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, hw));
        next += off;
      }
      walked += len;
    }
    return parts.join(' ');
  }
  const period = on + off;
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) continue;
    let s = 0;
    while (s < len) {
      const phase = (walked + s) % period;
      if (phase < on) {
        const e = Math.min(len, s + (on - phase));
        const p = { x: a.x + ((b.x - a.x) * s) / len, y: a.y + ((b.y - a.y) * s) / len };
        const q = { x: a.x + ((b.x - a.x) * e) / len, y: a.y + ((b.y - a.y) * e) / len };
        if (e - s > 0.05) parts.push(quad(p, q, hw));
        s = e;
      } else {
        s = Math.min(len, s + (period - phase));
      }
    }
    walked += len;
  }
  return parts.join(' ');
}

/** Arrowheads on the ends of an open line (SVG path data, filled). */
export function arrowPath(stroke: Pick<Stroke, 'points' | 'size' | 'arrowStart' | 'arrowEnd'>): string {
  if (!stroke.arrowStart && !stroke.arrowEnd) return '';
  const pts = centreLine(stroke);
  if (pts.length < 2) return '';
  const L = Math.max(9, stroke.size * 4.5);
  const head = (tip: Point, along: Point[]) => {
    // A point L back along the line gives the arrow's direction (works for curves too).
    let back = along[along.length - 1]!;
    for (const p of along) {
      if (Math.hypot(p.x - tip.x, p.y - tip.y) >= L) {
        back = p;
        break;
      }
    }
    const dx = tip.x - back.x;
    const dy = tip.y - back.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const bx = tip.x - ux * L;
    const by = tip.y - uy * L;
    const w = L * 0.52;
    return `M${f(tip.x + ux * stroke.size * 0.6)},${f(tip.y + uy * stroke.size * 0.6)} L${f(bx - uy * w)},${f(by + ux * w)} L${f(bx + ux * L * 0.18)},${f(by + uy * L * 0.18)} L${f(bx + uy * w)},${f(by - ux * w)} Z`;
  };
  const parts: string[] = [];
  if (stroke.arrowEnd) parts.push(head(pts[pts.length - 1]!, [...pts].reverse()));
  if (stroke.arrowStart) parts.push(head(pts[0]!, pts));
  return parts.join(' ');
}

/** Tape: a band `size` wide along its points (SVG path data, filled). */
export function tapePath(stroke: Pick<Stroke, 'points' | 'size'>): string {
  const pts = centreLine(stroke);
  if (pts.length < 2) return '';
  const hw = stroke.size / 2;
  // Simplify to the ends of straight runs so a long tape is a handful of pieces.
  const parts: string[] = [];
  let start = pts[0]!;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    if (Math.hypot(p.x - start.x, p.y - start.y) < 0.01) continue;
    parts.push(quad(start, p, hw));
    start = p;
  }
  return parts.join(' ');
}

/** A new piece of tape from a to b. */
export function makeTapeStroke(a: Point, b: Point, color: string, width: number, id = newId()): Stroke {
  return {
    id,
    tool: 'tape',
    color,
    size: width,
    hasPressure: false,
    points: [a.x, a.y, 0, b.x, b.y, 0],
    createdAt: Date.now(),
  };
}
