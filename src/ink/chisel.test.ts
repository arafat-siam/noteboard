import { describe, expect, it } from 'vitest';
import { chiselPath, rotateNibAngles } from './chisel';

/** Bounding box of every coordinate in an SVG path made of M/L commands. */
function bbox(d: string) {
  const nums = [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  const xs = nums.map((n) => n[0]);
  const ys = nums.map((n) => n[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

const horizontal = (angle: number) => Array.from({ length: 40 }, (_, i) => [100 + i * 5, 200, angle]).flat();

describe('chisel highlighter', () => {
  it('is wide when the tip is across the direction of travel', () => {
    const across = bbox(chiselPath(horizontal(Math.PI / 2), 20)); // tip vertical, moving right
    expect(across.h).toBeCloseTo(20, 0);
  });

  it('is thin when the tip points along the direction of travel', () => {
    const along = bbox(chiselPath(horizontal(0), 20)); // tip horizontal, moving right
    expect(along.h).toBeLessThan(6);
  });

  it('rotating a stroke turns its tip angles too', () => {
    expect(rotateNibAngles([0, 0, 0.5], Math.PI / 2)[2]).toBeCloseTo(0.5 + Math.PI / 2, 3);
    expect(rotateNibAngles([0, 0, 3], 1)[2]).toBeCloseTo(4 - Math.PI, 3); // wraps into 0..π
  });
});
