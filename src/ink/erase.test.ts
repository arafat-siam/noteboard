import { describe, expect, it } from 'vitest';
import { densify, eraseFromStroke } from './erase';
import type { Stroke } from '../model/types';

let n = 0;
const id = () => `piece-${++n}`;
const line = (x0: number, x1: number): Stroke => ({
  id: 'orig',
  tool: 'pen',
  color: '#000',
  size: 2,
  points: [x0, 100, 0.5, x1, 100, 0.5],
  hasPressure: true,
  createdAt: 1,
});

describe('partial eraser', () => {
  it('cuts a line in two when erasing the middle', () => {
    const pieces = eraseFromStroke(line(0, 200), { x: 100, y: 100 }, 10, id)!;
    expect(pieces).toHaveLength(2);
    const ends = pieces.map((p) => [p.points[0], p.points[p.points.length - 3]]);
    expect(ends[0]![1]).toBeLessThan(92);
    expect(ends[1]![0]).toBeGreaterThan(108);
  });

  it('shortens a line when erasing one end', () => {
    const pieces = eraseFromStroke(line(0, 200), { x: 195, y: 100 }, 10, id)!;
    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.points[pieces[0]!.points.length - 3]).toBeLessThan(186);
  });

  it('leaves untouched strokes alone', () => {
    expect(eraseFromStroke(line(0, 200), { x: 100, y: 150 }, 10, id)).toBeNull();
  });

  it('removes a stroke completely when the eraser covers it', () => {
    expect(eraseFromStroke(line(95, 105), { x: 100, y: 100 }, 12, id)).toEqual([]);
  });

  it('keeps style and gives pieces new ids', () => {
    const [a] = eraseFromStroke({ ...line(0, 200), color: '#f00', brush: 'pencil' }, { x: 100, y: 100 }, 5, id)!;
    expect(a!.color).toBe('#f00');
    expect(a!.brush).toBe('pencil');
    expect(a!.id).not.toBe('orig');
  });

  it('densify interpolates long gaps', () => {
    expect(densify([0, 0, 0.5, 10, 0, 0.5], 1).length / 3).toBeGreaterThanOrEqual(10);
  });
});
