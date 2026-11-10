import { getStroke } from 'perfect-freehand';
import type { Stroke } from '../model/types';

/**
 * Tuned for precision: low streamline keeps ink glued to the Pencil tip,
 * light smoothing removes digitizer jitter without rounding off handwriting.
 */
export function strokeOutline(stroke: Pick<Stroke, 'points' | 'size' | 'tool' | 'hasPressure'>, complete: boolean) {
  const input: [number, number, number][] = [];
  for (let i = 0; i + 2 < stroke.points.length + 1; i += 3) {
    input.push([stroke.points[i]!, stroke.points[i + 1]!, stroke.points[i + 2] ?? 0.5]);
  }
  const highlighter = stroke.tool === 'highlighter';
  return getStroke(input, {
    size: stroke.size,
    thinning: highlighter ? 0 : 0.6,
    // Streamline makes ink trail behind the tip, so keep it minimal; Pencil input is already clean.
    smoothing: 0.35,
    streamline: 0.04,
    simulatePressure: !stroke.hasPressure && !highlighter,
    last: complete,
    start: { taper: 0, cap: true },
    end: { taper: 0, cap: true },
  });
}

/** SVG path data for a perfect-freehand outline (quadratic curves through midpoints). */
export function outlineToSvgPath(outline: number[][]): string {
  if (outline.length < 2) return '';
  const avg = (a: number, b: number) => ((a + b) / 2).toFixed(2);
  const [first, second] = [outline[0]!, outline[1]!];
  let d = `M${first[0]!.toFixed(2)},${first[1]!.toFixed(2)} Q${second[0]!.toFixed(2)},${second[1]!.toFixed(2)} ${avg(
    second[0]!,
    outline[2]?.[0] ?? second[0]!,
  )},${avg(second[1]!, outline[2]?.[1] ?? second[1]!)} T`;
  for (let i = 2; i < outline.length - 1; i++) {
    const a = outline[i]!;
    const b = outline[i + 1]!;
    d += `${avg(a[0]!, b[0]!)},${avg(a[1]!, b[1]!)} `;
  }
  return `${d}Z`;
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

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, live = false): void {
  const path = live ? new Path2D(outlineToSvgPath(strokeOutline(stroke, false))) : cachedPath(stroke);
  ctx.save();
  if (stroke.tool === 'highlighter') {
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = 'multiply';
  }
  ctx.fillStyle = stroke.color;
  ctx.fill(path);
  ctx.restore();
}

/** Clears and redraws every stroke. `scale` maps page units to canvas pixels. */
export function drawPage(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  scale: number,
  hidden?: ReadonlySet<string>,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  // Highlighter first so it sits behind ink, like a real highlighter.
  for (const s of strokes) if (s.tool === 'highlighter' && !hidden?.has(s.id)) drawStroke(ctx, s);
  for (const s of strokes) if (s.tool !== 'highlighter' && !hidden?.has(s.id)) drawStroke(ctx, s);
}
