import { describe, expect, it } from 'vitest';
import { smoothInput } from './smoothing';

// Deterministic noise.
const noise = (i: number, amount: number) => {
  const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (v - Math.floor(v) - 0.5) * 2 * amount; // white-ish noise in [-amount, amount]
};

function jitteryLine(n: number, posNoise: number, pressureNoise: number): number[] {
  const flat: number[] = [];
  for (let i = 0; i < n; i++) flat.push(i * 1.2 + noise(i, posNoise), 50 + noise(i + 7, posNoise), 0.5 + noise(i + 3, pressureNoise));
  return flat;
}

/** Sum of absolute second differences: how "kinky" a sequence is. */
function roughness(values: number[]): number {
  let r = 0;
  for (let i = 2; i < values.length; i++) r += Math.abs(values[i]! - 2 * values[i - 1]! + values[i - 2]!);
  return r;
}

describe('smoothInput', () => {
  it('removes most positional jitter', () => {
    const raw = jitteryLine(120, 0.6, 0);
    const smoothed = smoothInput(raw);
    const rawY = raw.filter((_, i) => i % 3 === 1);
    expect(roughness(smoothed.map((p) => p[1]))).toBeLessThan(roughness(rawY) * 0.3);
  });

  it('removes most pressure jitter', () => {
    const raw = jitteryLine(120, 0, 0.15);
    const smoothed = smoothInput(raw);
    const rawP = raw.filter((_, i) => i % 3 === 2);
    expect(roughness(smoothed.map((p) => p[2]))).toBeLessThan(roughness(rawP) * 0.2);
  });

  it('keeps the first and last point exactly (ink starts and ends under the tip)', () => {
    const raw = jitteryLine(60, 0.6, 0.1);
    const smoothed = smoothInput(raw);
    expect(smoothed[0]!.slice(0, 2)).toEqual([raw[0], raw[1]]);
    expect(smoothed[smoothed.length - 1]!.slice(0, 2)).toEqual([raw[raw.length - 3], raw[raw.length - 2]]);
  });

  it('merges samples that barely moved', () => {
    const raw = [0, 0, 0.5, 0.1, 0, 0.5, 0.2, 0.1, 0.5, 10, 10, 0.5];
    expect(smoothInput(raw)).toHaveLength(2);
  });

  it('preserves the shape of real handwriting curves', () => {
    // A clean circle should stay a circle (radius within 2%).
    const flat: number[] = [];
    for (let i = 0; i <= 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      flat.push(100 + 40 * Math.cos(a), 100 + 40 * Math.sin(a), 0.5);
    }
    for (const [x, y] of smoothInput(flat)) expect(Math.abs(Math.hypot(x - 100, y - 100) - 40)).toBeLessThan(0.8);
  });
});
