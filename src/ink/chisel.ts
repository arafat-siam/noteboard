/**
 * Chisel-tip highlighter, like a real marker: the tip is a flat rectangle, so the line is
 * wide across the tip and thin along it. For these strokes the third value of each point
 * holds the tip angle (radians, 0..π) instead of pressure — so moving, scaling, cutting and
 * syncing strokes keeps working unchanged. Barrel roll on Apple Pencil Pro turns the tip.
 */

/** Tip direction when no barrel roll is known: tilted like a highlighter held normally. */
export const DEFAULT_NIB_ANGLE = (75 * Math.PI) / 180;
/** Tip thickness as a fraction of its width. */
const THICKNESS = 0.22;
const MIN_STEP = 0.5;

type P = [number, number];

function normalise(a: number): number {
  const r = a % Math.PI;
  return r < 0 ? r + Math.PI : r;
}

/** Adds every polygon with the same (counter-clockwise) winding so overlaps merge cleanly. */
function polygon(points: P[]): string {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    area += x1 * y2 - x2 * y1;
  }
  const ordered = area < 0 ? [...points].reverse() : points;
  const f = (v: number) => (Math.round(v * 100) / 100).toString();
  return `M${ordered.map(([x, y]) => `${f(x)},${f(y)}`).join(' L')} Z`;
}

/** SVG path for a chisel stroke: the tip swept along the path (union of quads + tip rects). */
export function chiselPath(flat: number[], width: number): string {
  // Thin out samples that barely moved, keeping each one's tip angle.
  const pts: { x: number; y: number; a: number }[] = [];
  for (let i = 0; i + 1 < flat.length; i += 3) {
    const x = flat[i]!;
    const y = flat[i + 1]!;
    const a = normalise(flat[i + 2] ?? DEFAULT_NIB_ANGLE);
    const last = pts[pts.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < MIN_STEP) {
      last.a = a;
      continue;
    }
    pts.push({ x, y, a });
  }
  if (!pts.length) return '';

  // Smooth tip angles (on the doubled angle, since a tip at θ and θ+π is the same tip).
  const smoothed = pts.map((_, i) => {
    let sx = 0;
    let sy = 0;
    for (let k = -2; k <= 2; k++) {
      const q = pts[i + k];
      if (!q) continue;
      sx += Math.cos(2 * q.a);
      sy += Math.sin(2 * q.a);
    }
    return Math.atan2(sy, sx) / 2;
  });

  const half = width / 2;
  const thick = (width * THICKNESS) / 2;
  const ends = (i: number): [P, P] => {
    const p = pts[i]!;
    const dx = Math.cos(smoothed[i]!) * half;
    const dy = Math.sin(smoothed[i]!) * half;
    return [
      [p.x - dx, p.y - dy],
      [p.x + dx, p.y + dy],
    ];
  };
  const tip = (i: number): P[] => {
    const p = pts[i]!;
    const a = smoothed[i]!;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const vx = -uy * thick;
    const vy = ux * thick;
    return [
      [p.x - ux * half - vx, p.y - uy * half - vy],
      [p.x + ux * half - vx, p.y + uy * half - vy],
      [p.x + ux * half + vx, p.y + uy * half + vy],
      [p.x - ux * half + vx, p.y - uy * half + vy],
    ];
  };

  const parts: string[] = [];
  // The tip itself at the start, the end and every few samples (gives the line its thickness).
  for (let i = 0; i < pts.length; i += 2) parts.push(polygon(tip(i)));
  if (pts.length > 1) parts.push(polygon(tip(pts.length - 1)));
  // The area swept between consecutive tip positions. When the tip turns between two samples
  // that quad can fold into a bow-tie (which would leave a gap), so fill it with all four
  // triangles over its corners instead — triangles never fold.
  for (let i = 1; i < pts.length; i++) {
    const [a0, a1] = ends(i - 1);
    const [b0, b1] = ends(i);
    parts.push(polygon([a0, a1, b1]), polygon([a0, b1, b0]), polygon([a0, a1, b0]), polygon([a1, b1, b0]));
  }
  return parts.join(' ');
}

/** Rotates the stored tip angles along with a stroke. */
export function rotateNibAngles(flat: number[], angle: number): number[] {
  const out = flat.slice();
  for (let i = 2; i < out.length; i += 3) out[i] = Math.round(normalise(out[i]! + angle) * 1000) / 1000;
  return out;
}
