/**
 * Cleans up raw Pencil samples before they become ink.
 *
 * The Pencil reports ~240 positions a second, each with a little digitizer noise in position
 * and (much more) in pressure. Drawn as-is, that noise shows up as tiny kinks, sharp corners
 * and lumpy line width. We keep the raw samples in storage and smooth them at draw time:
 *  1. drop samples that barely moved (they only add jitter),
 *  2. average each position with its neighbours (Gaussian window),
 *  3. average pressure over a wider window (width should change gradually, like real ink).
 * The first and last points are kept exactly, so the line still starts and ends under the tip.
 */

export type InputPoint = [x: number, y: number, pressure: number];

/** Samples closer than this (page units ≈ CSS px at 100%) to the previous one are merged. */
const MIN_DISTANCE = 0.45;
const POSITION_KERNEL = [1, 4, 6, 4, 1];
const PRESSURE_KERNEL = [1, 2, 3, 4, 5, 4, 3, 2, 1];

function convolve(values: number[], kernel: number[], keepEnds: boolean): number[] {
  const radius = (kernel.length - 1) / 2;
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    if (keepEnds && (i === 0 || i === values.length - 1)) {
      out[i] = values[i]!;
      continue;
    }
    let sum = 0;
    let weight = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= values.length) continue; // renormalise at the ends
      const w = kernel[k + radius]!;
      sum += values[j]! * w;
      weight += w;
    }
    out[i] = sum / weight;
  }
  return out;
}

export function smoothInput(flat: number[]): InputPoint[] {
  const xs: number[] = [];
  const ys: number[] = [];
  const ps: number[] = [];
  for (let i = 0; i + 1 < flat.length; i += 3) {
    const x = flat[i]!;
    const y = flat[i + 1]!;
    const p = flat[i + 2] ?? 0.5;
    const last = xs.length - 1;
    if (last >= 0 && Math.hypot(x - xs[last]!, y - ys[last]!) < MIN_DISTANCE) {
      // Merge into the previous sample: keep the newest pressure reading.
      ps[last] = p;
      continue;
    }
    xs.push(x);
    ys.push(y);
    ps.push(p);
  }
  // Always keep the true final position (the pen tip), even if it barely moved.
  const n = flat.length;
  if (n >= 3 && xs.length > 1) {
    xs[xs.length - 1] = flat[n - 3]!;
    ys[ys.length - 1] = flat[n - 2]!;
  }
  if (xs.length < 3) return xs.map((x, i) => [x, ys[i]!, ps[i]!]);

  const sx = convolve(xs, POSITION_KERNEL, true);
  const sy = convolve(ys, POSITION_KERNEL, true);
  const sp = convolve(ps, PRESSURE_KERNEL, false);
  return sx.map((x, i) => [x, sy[i]!, sp[i]!]);
}
