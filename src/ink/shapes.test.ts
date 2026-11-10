import { describe, expect, it } from 'vitest';
import { recognizeShape } from './shapes';
import type { Point } from './geometry';

// Deterministic "hand wobble".
const wobble = (i: number, amount: number) => Math.sin(i * 1.7) * amount;

function line(a: Point, b: Point, n = 40, jitter = 1.5): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: a.x + ((b.x - a.x) * i) / n + wobble(i, jitter),
    y: a.y + ((b.y - a.y) * i) / n + wobble(i + 3, jitter),
  }));
}

function polygon(corners: Point[], jitter = 2): Point[] {
  const pts: Point[] = [];
  corners.forEach((c, i) => pts.push(...line(c, corners[(i + 1) % corners.length]!, 25, jitter).slice(0, -1)));
  pts.push({ x: corners[0]!.x + 3, y: corners[0]!.y + 2 });
  return pts;
}

function ellipse(cx: number, cy: number, rx: number, ry: number, jitter = 2): Point[] {
  return Array.from({ length: 81 }, (_, i) => {
    const a = (i / 80) * Math.PI * 2 * 0.97;
    return { x: cx + (rx + wobble(i, jitter)) * Math.cos(a), y: cy + (ry + wobble(i, jitter)) * Math.sin(a) };
  });
}

describe('recognizeShape', () => {
  it('recognizes a wobbly straight line', () => {
    expect(recognizeShape(line({ x: 10, y: 10 }, { x: 300, y: 120 }))?.kind).toBe('line');
  });

  it('recognizes a circle', () => {
    expect(recognizeShape(ellipse(200, 200, 80, 80))?.kind).toBe('circle');
  });

  it('recognizes an ellipse', () => {
    expect(recognizeShape(ellipse(200, 200, 150, 70))?.kind).toBe('ellipse');
  });

  it('recognizes a rectangle and snaps it upright', () => {
    const shape = recognizeShape(
      polygon([{ x: 50, y: 50 }, { x: 300, y: 55 }, { x: 298, y: 200 }, { x: 52, y: 196 }]),
    );
    expect(shape?.kind).toBe('rectangle');
    const xs = shape!.points.map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThan(40);
  });

  it('recognizes a triangle', () => {
    expect(recognizeShape(polygon([{ x: 100, y: 300 }, { x: 200, y: 80 }, { x: 320, y: 300 }]))?.kind).toBe(
      'triangle',
    );
  });

  it('recognizes a straight line even with the hold-still jitter at the end', () => {
    const pts = line({ x: 40, y: 300 }, { x: 420, y: 260 }, 120, 1.2);
    // Pencil held still at the end: a cluster of tiny wiggles around the tip.
    const end = pts[pts.length - 1]!;
    for (let i = 0; i < 40; i++) pts.push({ x: end.x + Math.sin(i * 2.1) * 2, y: end.y + Math.cos(i * 1.7) * 2 });
    const shape = recognizeShape(pts);
    expect(shape?.kind).toBe('line');
    const last = shape!.points[shape!.points.length - 1]!;
    expect(Math.hypot(last.x - 420, last.y - 260)).toBeLessThan(6);
  });

  it('recognizes a short line', () => {
    expect(recognizeShape(line({ x: 10, y: 10 }, { x: 70, y: 12 }, 25, 0.8))?.kind).toBe('line');
  });

  it('recognizes a tilted ellipse', () => {
    const tilt = Math.PI / 5;
    const pts = ellipse(0, 0, 160, 60).map((p) => ({
      x: 300 + (p.x * Math.cos(tilt) - p.y * Math.sin(tilt)),
      y: 300 + (p.x * Math.sin(tilt) + p.y * Math.cos(tilt)),
    }));
    expect(recognizeShape(pts)?.kind).toBe('ellipse');
  });

  it('recognizes an L-shaped polyline', () => {
    const pts = [...line({ x: 50, y: 50 }, { x: 50, y: 250 }, 40, 1.2).slice(0, -1), ...line({ x: 50, y: 250 }, { x: 260, y: 250 }, 40, 1.2)];
    expect(recognizeShape(pts)?.kind).toBe('polyline');
  });

  it('recognizes a rotated rectangle', () => {
    const c = (x: number, y: number) => ({ x: 300 + x * 0.94 - y * 0.34, y: 300 + x * 0.34 + y * 0.94 });
    expect(recognizeShape(polygon([c(-120, -70), c(120, -70), c(120, 70), c(-120, 70)]))?.kind).toBe('rectangle');
  });

  it('leaves handwriting alone', () => {
    // A zig-zag scribble that is neither closed nor straight.
    const scribble = Array.from({ length: 60 }, (_, i) => ({ x: i * 5, y: (i % 2) * 30 + (i % 7) * 4 }));
    expect(recognizeShape(scribble)).toBeNull();
  });

  it('ignores tiny marks', () => {
    expect(recognizeShape(line({ x: 0, y: 0 }, { x: 5, y: 3 }, 6, 0))).toBeNull();
  });
});
