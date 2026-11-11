import { getStroke } from 'perfect-freehand';
import type { Stroke } from '../model/types';
import { smoothInput } from './smoothing';
import { BRUSHES } from './brushes';

export function brushOf(stroke: Pick<Stroke, 'tool' | 'brush'>) {
  return stroke.tool === 'highlighter' ? null : BRUSHES[stroke.brush ?? 'fountain'];
}

/**
 * Input is pre-smoothed (smoothing.ts) so curves are fluid and line width changes gradually;
 * streamline stays low so the ink still sits right under the Pencil tip.
 */
export function strokeOutline(
  stroke: Pick<Stroke, 'points' | 'size' | 'tool' | 'hasPressure' | 'brush'>,
  complete: boolean,
) {
  const input = smoothInput(stroke.points);
  const brush = brushOf(stroke);
  const taper = brush?.taper ?? 0;
  return getStroke(input, {
    size: stroke.size,
    thinning: brush ? brush.thinning : 0,
    smoothing: 0.62,
    streamline: 0.18,
    simulatePressure: !stroke.hasPressure && !!brush,
    last: complete,
    start: { taper, cap: taper === 0 },
    // The live stroke's end is the pen tip: never taper it while still drawing.
    end: { taper: complete ? taper : 0, cap: taper === 0 || !complete },
  });
}

/**
 * SVG path data for a closed perfect-freehand outline: quadratic curves through the outline
 * midpoints. Uses only explicit M/Q/Z commands — PDF libraries mis-read the T shorthand,
 * which turned every exported stroke into spikes.
 */
export function outlineToSvgPath(outline: number[][]): string {
  const n = outline.length;
  if (n < 3) return '';
  const f = (v: number) => (Math.round(v * 100) / 100).toString();
  const mid = (i: number) => {
    const a = outline[i % n]!;
    const b = outline[(i + 1) % n]!;
    return `${f((a[0]! + b[0]!) / 2)},${f((a[1]! + b[1]!) / 2)}`;
  };
  let d = `M${mid(0)}`;
  for (let i = 1; i <= n; i++) {
    const p = outline[i % n]!;
    d += ` Q${f(p[0]!)},${f(p[1]!)} ${mid(i)}`;
  }
  return `${d} Z`;
}

/** Grainy graphite pattern for the pencil, one per colour. */
const pencilPatterns = new Map<string, CanvasPattern | null>();

function pencilPattern(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | null {
  if (pencilPatterns.has(color)) return pencilPatterns.get(color)!;
  let pattern: CanvasPattern | null = null;
  try {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 48;
    const t = tile.getContext('2d')!;
    t.fillStyle = color;
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 1500; i++) {
      t.globalAlpha = 0.35 + rand() * 0.65;
      t.fillRect(rand() * 48, rand() * 48, 0.6 + rand() * 0.9, 0.6 + rand() * 0.9);
    }
    pattern = ctx.createPattern(tile, 'repeat');
    pattern?.setTransform(new DOMMatrix().scale(0.25));
  } catch {
    pattern = null;
  }
  pencilPatterns.set(color, pattern);
  return pattern;
}

const pathCache = new Map<string, Path2D>();
const MAX_CACHE = 20_000;

function cachedPath(stroke: Stroke): Path2D {
  let path = pathCache.get(stroke.id);
  if (!path) {
    path = new Path2D(outlineToSvgPath(strokeOutline(stroke, true)));
    if (pathCache.size >= MAX_CACHE) pathCache.clear();
    pathCache.set(stroke.id, path);
  }
  return path;
}

/** SVG path of the area inside a stroke (its centre line, closed). */
export function fillSvgPath(stroke: Pick<Stroke, 'points'>): string {
  const p = stroke.points;
  if (p.length < 9) return '';
  const f = (v: number) => (Math.round(v * 100) / 100).toString();
  let d = `M${f(p[0]!)},${f(p[1]!)}`;
  for (let i = 3; i + 1 < p.length; i += 3) d += ` L${f(p[i]!)},${f(p[i + 1]!)}`;
  return `${d} Z`;
}

export const DEFAULT_FILL_OPACITY = 0.3;

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, live = false): void {
  const path = live ? new Path2D(outlineToSvgPath(strokeOutline(stroke, false))) : cachedPath(stroke);
  if (stroke.fill) {
    const area = fillSvgPath(stroke);
    if (area) {
      ctx.save();
      ctx.globalAlpha = stroke.fillOpacity ?? DEFAULT_FILL_OPACITY;
      ctx.fillStyle = stroke.fill;
      ctx.fill(new Path2D(area));
      ctx.restore();
    }
  }
  ctx.save();
  const brush = brushOf(stroke);
  if (!brush) {
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = 'multiply';
  } else {
    ctx.globalAlpha = brush.opacity;
  }
  ctx.fillStyle = (brush?.textured && pencilPattern(ctx, stroke.color)) || stroke.color;
  ctx.fill(path);
  ctx.restore();
}

const boundsCache = new Map<string, [number, number, number, number]>();

function cachedBounds(stroke: Stroke): [number, number, number, number] {
  let b = boundsCache.get(stroke.id);
  if (!b) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i + 1 < stroke.points.length; i += 3) {
      const x = stroke.points[i]!;
      const y = stroke.points[i + 1]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const pad = stroke.size;
    b = [minX - pad, minY - pad, maxX + pad, maxY + pad];
    if (boundsCache.size >= MAX_CACHE) boundsCache.clear();
    boundsCache.set(stroke.id, b);
  }
  return b;
}

/** The part of the page a canvas shows: page-unit origin and canvas pixels per page unit. */
export interface CanvasRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Canvas pixels per page unit. */
  k: number;
}

/** Sets the transform so drawing in page units lands correctly on a region canvas. */
export function applyRegion(ctx: CanvasRenderingContext2D, region: CanvasRegion): void {
  ctx.setTransform(region.k, 0, 0, region.k, -region.x * region.k, -region.y * region.k);
}

/** Clears and redraws every stroke that intersects the region. */
export function drawPage(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  region: CanvasRegion,
  hidden?: ReadonlySet<string>,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  applyRegion(ctx, region);
  const right = region.x + region.width;
  const bottom = region.y + region.height;
  const visible = (s: Stroke) => {
    if (hidden?.has(s.id)) return false;
    const [x0, y0, x1, y1] = cachedBounds(s);
    return x1 >= region.x && x0 <= right && y1 >= region.y && y0 <= bottom;
  };
  // Highlighter first so it sits behind ink, like a real highlighter.
  for (const s of strokes) if (s.tool === 'highlighter' && visible(s)) drawStroke(ctx, s);
  for (const s of strokes) if (s.tool !== 'highlighter' && visible(s)) drawStroke(ctx, s);
}
