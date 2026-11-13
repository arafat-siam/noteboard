import { getStroke } from 'perfect-freehand';
import type { Stroke } from '../model/types';
import { smoothInput } from './smoothing';
import { resolveBrush, type BrushStyle } from './brushes';
import { drawImageStroke } from './images';
import { drawTextStroke } from './text';
import { arrowPath, dashPath, tapePath } from './shapeTool';
import { displayColor, inkIsDark } from './inkTheme';
import { getPlayback } from './recording';

/** Items laid out on 4 corner points (pictures and text boxes) rather than drawn as ink. */
export const isBoxItem = (s: Pick<Stroke, 'tool'>) => s.tool === 'image' || s.tool === 'text';

export function brushOf(stroke: Pick<Stroke, 'tool' | 'brush' | 'penStyle'>): BrushStyle | null {
  return stroke.tool === 'pen' ? resolveBrush(stroke) : null;
}

/** Tape the user has tapped to peek under, this session only (never saved or synced). */
export const revealedTape = new Set<string>();

/** Flat-nib outline: each point is offset along a fixed 40° nib, so width follows direction. */
function calligraphyOutline(stroke: Pick<Stroke, 'points' | 'size' | 'hasPressure'>): number[][] {
  const input = smoothInput(stroke.points);
  if (input.length < 2) {
    const [x, y] = input[0] ?? [0, 0];
    const r = stroke.size / 2;
    return [
      [x - r, y - r],
      [x + r, y - r],
      [x + r, y + r],
      [x - r, y + r],
    ];
  }
  const angle = (-40 * Math.PI) / 180;
  const left: number[][] = [];
  const right: number[][] = [];
  for (const [x, y, pr] of input) {
    const half = stroke.size * (stroke.hasPressure ? 0.55 + pr * 0.7 : 0.9);
    const nx = Math.cos(angle) * half;
    const ny = Math.sin(angle) * half;
    left.push([x + nx, y + ny]);
    right.push([x - nx, y - ny]);
  }
  return [...left, ...right.reverse()];
}

/**
 * Input is pre-smoothed (smoothing.ts) so curves are fluid and line width changes gradually;
 * streamline stays low so the ink still sits right under the Pencil tip.
 */
export function strokeOutline(
  stroke: Pick<Stroke, 'points' | 'size' | 'tool' | 'hasPressure' | 'brush' | 'penStyle'>,
  complete: boolean,
) {
  const brush = brushOf(stroke);
  if (brush?.calligraphy) return calligraphyOutline(stroke);
  const input = smoothInput(stroke.points);
  const taper = brush?.taper ?? 0;
  const stabilize = brush?.stabilize ?? 0;
  return getStroke(input, {
    size: stroke.size,
    thinning: brush ? brush.thinning : 0,
    smoothing: Math.min(0.95, 0.62 + stabilize * 0.3),
    streamline: Math.min(0.85, 0.18 + stabilize * 0.55),
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

/** SVG path data of what is filled for a stroke (ink outline, dashes, or tape band). */
export function strokeSvgPath(stroke: Stroke, complete = true): string {
  if (stroke.tool === 'tape') return tapePath(stroke);
  if (stroke.dash && stroke.tool === 'pen') return dashPath(stroke);
  return outlineToSvgPath(strokeOutline(stroke, complete));
}

/** Grain textures: fine graphite for the pencil (1), coarse wax for the crayon (2). */
const grainPatterns = new Map<string, CanvasPattern | null>();

function grainPattern(ctx: CanvasRenderingContext2D, color: string, grain: 1 | 2): CanvasPattern | null {
  const key = `${grain}|${color}`;
  if (grainPatterns.has(key)) return grainPatterns.get(key)!;
  let pattern: CanvasPattern | null = null;
  try {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 48;
    const t = tile.getContext('2d')!;
    t.fillStyle = color;
    let seed = grain === 1 ? 7 : 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    if (grain === 1) {
      for (let i = 0; i < 1500; i++) {
        t.globalAlpha = 0.35 + rand() * 0.65;
        t.fillRect(rand() * 48, rand() * 48, 0.6 + rand() * 0.9, 0.6 + rand() * 0.9);
      }
    } else {
      t.globalAlpha = 0.55;
      t.fillRect(0, 0, 48, 48);
      for (let i = 0; i < 700; i++) {
        t.globalAlpha = 0.5 + rand() * 0.5;
        t.fillRect(rand() * 48, rand() * 48, 1.2 + rand() * 2.6, 0.8 + rand() * 1.4);
      }
      t.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 260; i++) {
        t.globalAlpha = 0.6 + rand() * 0.4;
        t.fillRect(rand() * 48, rand() * 48, 0.8 + rand() * 1.6, 0.6 + rand());
      }
    }
    pattern = ctx.createPattern(tile, 'repeat');
    pattern?.setTransform(new DOMMatrix().scale(grain === 1 ? 0.25 : 0.4));
  } catch {
    pattern = null;
  }
  grainPatterns.set(key, pattern);
  return pattern;
}

/** Diagonal stripes for tape. */
const tapePatterns = new Map<string, CanvasPattern | null>();
function tapePattern(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | null {
  if (tapePatterns.has(color)) return tapePatterns.get(color)!;
  let pattern: CanvasPattern | null = null;
  try {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 24;
    const t = tile.getContext('2d')!;
    t.fillStyle = color;
    t.fillRect(0, 0, 24, 24);
    t.strokeStyle = 'rgba(255,255,255,0.2)';
    t.lineWidth = 5;
    t.beginPath();
    for (let k = -24; k <= 48; k += 12) {
      t.moveTo(k, 24);
      t.lineTo(k + 24, 0);
    }
    t.stroke();
    pattern = ctx.createPattern(tile, 'repeat');
    pattern?.setTransform(new DOMMatrix().scale(0.5));
  } catch {
    pattern = null;
  }
  tapePatterns.set(color, pattern);
  return pattern;
}

const pathCache = new Map<string, Path2D>();
const MAX_CACHE = 20_000;

function cachedPath(stroke: Stroke): Path2D {
  let path = pathCache.get(stroke.id);
  if (!path) {
    path = new Path2D(strokeSvgPath(stroke));
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

function drawTape(ctx: CanvasRenderingContext2D, stroke: Stroke, path: Path2D): void {
  ctx.save();
  if (revealedTape.has(stroke.id)) {
    // Peeking: a faint outline shows where the tape is; tap again to cover up.
    ctx.globalAlpha *= 0.14;
    ctx.fillStyle = stroke.color;
    ctx.fill(path);
    ctx.globalAlpha *= 5;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.stroke(path);
  } else {
    ctx.fillStyle = tapePattern(ctx, stroke.color) ?? stroke.color;
    ctx.fill(path);
  }
  ctx.restore();
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, live = false): void {
  // Playing a recording: ink written later than the current moment is shown faded.
  const playback = getPlayback();
  if (playback && stroke.audio?.rec === playback.rec && stroke.audio.t > playback.t) {
    ctx.save();
    ctx.globalAlpha *= 0.16;
    drawStrokeNow(ctx, stroke, live);
    ctx.restore();
    return;
  }
  drawStrokeNow(ctx, stroke, live);
}

function drawStrokeNow(ctx: CanvasRenderingContext2D, stroke: Stroke, live: boolean): void {
  if (stroke.tool === 'image') {
    drawImageStroke(ctx, stroke);
    return;
  }
  if (stroke.tool === 'text') {
    drawTextStroke(ctx, stroke);
    return;
  }
  const path = live ? new Path2D(strokeSvgPath(stroke, false)) : cachedPath(stroke);
  if (stroke.tool === 'tape') {
    drawTape(ctx, stroke, path);
    return;
  }
  if (stroke.fill) {
    const area = fillSvgPath(stroke);
    if (area) {
      ctx.save();
      ctx.globalAlpha *= stroke.fillOpacity ?? DEFAULT_FILL_OPACITY;
      ctx.fillStyle = displayColor(stroke.fill);
      ctx.fill(new Path2D(area));
      ctx.restore();
    }
  }
  ctx.save();
  const brush = brushOf(stroke);
  // Highlighter: multiply on white paper (ink under it stays crisp); on dark paper multiply
  // would vanish, so it glows instead.
  const dark = inkIsDark();
  if (!brush) {
    ctx.globalAlpha *= dark ? 0.45 : 0.35;
    if (!dark) ctx.globalCompositeOperation = 'multiply';
  } else {
    ctx.globalAlpha *= brush.opacity;
  }
  const color = brush ? displayColor(stroke.color) : stroke.color;
  ctx.fillStyle = (brush?.grain && !stroke.dash && grainPattern(ctx, color, brush.grain)) || color;
  ctx.fill(path);
  if (brush?.calligraphy && !stroke.dash) {
    // Hairline where the stroke runs along the nib (the outline has no width there).
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.35, stroke.size * 0.12);
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  }
  if (stroke.arrowStart || stroke.arrowEnd) {
    ctx.fillStyle = color;
    ctx.fill(new Path2D(arrowPath(stroke)));
  }
  ctx.restore();
}

const boundsCache = new Map<string, [number, number, number, number]>();

/** How far ink reaches beyond its points (line width, tape width, arrowheads). */
export function strokeReach(stroke: Pick<Stroke, 'tool' | 'size' | 'arrowStart' | 'arrowEnd'>): number {
  if (stroke.tool === 'tape') return stroke.size / 2 + 1;
  if (stroke.arrowStart || stroke.arrowEnd) return Math.max(9, stroke.size * 4.5);
  return stroke.size;
}

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
    const pad = strokeReach(stroke);
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
  drawPageParts(ctx, strokes, region, hidden, [{ x: 0, y: 0, width: ctx.canvas.width, height: ctx.canvas.height }]);
}

/** A rectangle in canvas pixels. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Clears and redraws only the given parts of a region canvas (they must not overlap); the rest
 * of the canvas is left exactly as it is. Used when the canvas moves along the page while
 * scrolling: what is already drawn is kept and only the newly uncovered strip is drawn.
 */
export function drawPageParts(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  region: CanvasRegion,
  hidden: ReadonlySet<string> | undefined,
  parts: PixelRect[],
): void {
  if (!parts.length) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  for (const p of parts) {
    ctx.clearRect(p.x, p.y, p.width, p.height);
    ctx.rect(p.x, p.y, p.width, p.height);
  }
  // Whole-pixel clip: ink drawn across the edge of a part can't touch what is kept.
  ctx.clip();
  applyRegion(ctx, region);
  const areas = parts.map((p) => [
    region.x + p.x / region.k,
    region.y + p.y / region.k,
    region.x + (p.x + p.width) / region.k,
    region.y + (p.y + p.height) / region.k,
  ]);
  // In stacking order (oldest first; see Stroke.createdAt), so layering works for ink and
  // pictures alike. The highlighter blends (multiply), so ink under it stays crisp.
  for (const s of strokes) {
    if (hidden?.has(s.id)) continue;
    const [x0, y0, x1, y1] = cachedBounds(s);
    if (areas.some((a) => x1 >= a[0]! && x0 <= a[2]! && y1 >= a[1]! && y0 <= a[3]!)) drawStroke(ctx, s);
  }
  ctx.restore();
}
