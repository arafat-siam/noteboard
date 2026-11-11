import { describe, expect, it } from 'vitest';
import type { Stroke } from '../model/types';
import { buildGuides, sameSnap, snapLineEnd, snapToPoint } from './snapping';

const line = (id: string, x0: number, y0: number, x1: number, y1: number): Stroke => {
  const points: number[] = [];
  for (let i = 0; i <= 20; i++) points.push(x0 + ((x1 - x0) * i) / 20, y0 + ((y1 - y0) * i) / 20, 0.5);
  return { id, tool: 'pen', color: '#000', size: 2, hasPressure: true, createdAt: 1, points };
};

const handwriting = (): Stroke => {
  const points: number[] = [];
  for (let i = 0; i < 200; i++) points.push(300 + i, 300 + Math.sin(i / 3) * 12, 0.5);
  return { id: 'hw', tool: 'pen', color: '#000', size: 2, hasPressure: true, createdAt: 1, points };
};

describe('snapping', () => {
  const guides = buildGuides([line('h', 100, 100, 300, 100), handwriting()]);

  it('finds straight ink but ignores handwriting', () => {
    expect(guides.segments).toHaveLength(1);
  });

  it('snaps to the midpoint of a line (bisect) and to its ends', () => {
    expect(snapToPoint({ x: 203, y: 104 }, guides, 8)).toMatchObject({ kind: 'mid', point: { x: 200, y: 100 } });
    expect(snapToPoint({ x: 297, y: 98 }, guides, 8)).toMatchObject({ kind: 'end', point: { x: 300, y: 100 } });
    expect(snapToPoint({ x: 250, y: 140 }, guides, 8)).toBeNull();
  });

  it('makes a nearly perpendicular line exactly perpendicular, ending on the line', () => {
    const r = snapLineEnd({ x: 150, y: 250 }, { x: 154, y: 102 }, guides, 8)!;
    expect(r.kind).toBe('perpendicular');
    expect(r.point.x).toBeCloseTo(150, 5);
    expect(r.point.y).toBeCloseTo(100, 5);
  });

  it('ends on the line the Pencil reaches, not another line at the same angle', () => {
    const rect = line('r', 100, 330, 330, 330); // another horizontal line just below the start
    const both = buildGuides([rect, line('h', 100, 100, 300, 100)]);
    const r = snapLineEnd({ x: 250, y: 300 }, { x: 255, y: 104 }, both, 9.75)!;
    expect(r.kind).toBe('perpendicular');
    expect(r.point.x).toBeCloseTo(250, 5);
    expect(r.point.y).toBeCloseTo(100, 5);
  });

  it('makes a nearly parallel line exactly parallel', () => {
    const r = snapLineEnd({ x: 100, y: 130 }, { x: 260, y: 136 }, guides, 8)!;
    expect(r.kind).toBe('parallel');
    expect(r.point.y).toBeCloseTo(130, 5);
  });

  it('straightens lines to page angles away from other ink', () => {
    const r = snapLineEnd({ x: 500, y: 800 }, { x: 600, y: 703 }, guides, 8)!;
    expect(r.kind).toBe('angle');
    expect(r.degrees).toBeCloseTo(315, 5); // 45° up and to the right
    const free = snapLineEnd({ x: 500, y: 800 }, { x: 600, y: 760 }, guides, 8);
    expect(free).toBeNull(); // 21.8°: not near any snap angle
  });

  it('only reports a new snap when the target changes', () => {
    const a = snapToPoint({ x: 201, y: 101 }, guides, 8);
    const b = snapToPoint({ x: 199, y: 99 }, guides, 8);
    expect(sameSnap(a, b)).toBe(true);
    expect(sameSnap(a, null)).toBe(false);
  });
});
