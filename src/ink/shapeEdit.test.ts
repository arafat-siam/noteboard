import { describe, expect, it } from 'vitest';
import type { Stroke } from '../model/types';
import { dragVertex, shapeVertices, strokeThrough } from './shapeEdit';
import { polylinePoints } from './shapes';
import type { Point } from './geometry';

const shape = (vertices: Point[], closed: boolean): Stroke => ({
  id: 's',
  tool: 'pen',
  color: '#000',
  size: 2,
  hasPressure: true,
  createdAt: 1,
  points: polylinePoints(vertices, closed).flatMap((p) => [p.x, p.y, 0.5]),
});

describe('editing shapes by their points', () => {
  it('a line has 2 points, a rectangle 4, a pentagon 5', () => {
    expect(shapeVertices(shape([{ x: 10, y: 10 }, { x: 200, y: 80 }], false))?.vertices).toHaveLength(2);
    const rect = shapeVertices(shape([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }], true))!;
    expect(rect.vertices).toHaveLength(4);
    expect(rect.rectangle).toBe(true);
    const penta = Array.from({ length: 5 }, (_, i) => ({ x: 100 + 50 * Math.cos((i * 2 * Math.PI) / 5), y: 100 + 50 * Math.sin((i * 2 * Math.PI) / 5) }));
    const p = shapeVertices(shape(penta, true))!;
    expect(p.vertices).toHaveLength(5);
    expect(p.rectangle).toBe(false);
  });

  it('handwriting and circles are not edited by points', () => {
    const wavy: Point[] = Array.from({ length: 80 }, (_, i) => ({ x: i * 3, y: Math.sin(i / 4) * 15 }));
    expect(shapeVertices(shape(wavy, false))).toBeNull();
    const circle = Array.from({ length: 60 }, (_, i) => ({ x: 100 + 50 * Math.cos((i * 2 * Math.PI) / 60), y: 100 + 50 * Math.sin((i * 2 * Math.PI) / 60) }));
    expect(shapeVertices(shape(circle, true))).toBeNull();
  });

  it('dragging a rectangle corner keeps it a rectangle, opposite corner fixed', () => {
    const rect = shapeVertices(shape([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }], true))!;
    const out = dragVertex(rect, 2, { x: 150, y: 90 });
    expect(out).toEqual([{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 90 }, { x: 0, y: 90 }]);
  });

  it('dragging a polygon point moves only that point, and the stroke follows', () => {
    const tri = shapeVertices(shape([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }], true))!;
    const out = dragVertex(tri, 2, { x: 50, y: 120 });
    expect(out[2]).toEqual({ x: 50, y: 120 });
    expect(out[0]).toEqual({ x: 0, y: 0 });
    const redrawn = strokeThrough(shape([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }], true), out, true, 'new');
    expect(redrawn.id).toBe('new');
    expect(shapeVertices(redrawn)?.vertices).toHaveLength(3);
  });
});
