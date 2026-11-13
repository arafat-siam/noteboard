import { describe, expect, it } from 'vitest';
import { displayDegrees, edgeNear, projectOnEdge, protractorDegrees, snapAngle, type ProtractorGuide, type RulerGuide } from './guides';

const ruler: RulerGuide = { kind: 'ruler', cx: 400, cy: 300, angle: 0, length: 600, width: 80 };
const protractor: ProtractorGuide = { kind: 'protractor', cx: 400, cy: 300, angle: 0, radius: 150 };

describe('ruler and protractor', () => {
  it('strokes near the ruler follow its edge exactly', () => {
    const edge = edgeNear(ruler, { x: 300, y: 350 })!; // 10 px below the lower edge (y = 340)
    expect(edge).not.toBeNull();
    expect(projectOnEdge(edge, { x: 320, y: 358 })).toEqual({ x: 320, y: 340 });
    expect(projectOnEdge(edge, { x: 500, y: 343 }, 2)).toEqual({ x: 500, y: 342 });
    expect(edgeNear(ruler, { x: 300, y: 450 })).toBeNull(); // far away: normal ink
  });

  it('strokes near the protractor follow its arc', () => {
    const edge = edgeNear(protractor, { x: 400, y: 140 })!;
    const p = projectOnEdge(edge, { x: 520, y: 200 });
    expect(Math.hypot(p.x - 400, p.y - 300)).toBeCloseTo(150);
    expect(protractorDegrees(protractor, { x: 400, y: 150 })).toBe(90);
    expect(protractorDegrees(protractor, { x: 550, y: 300 })).toBe(0);
  });

  it('angles snap to 15° steps and read 0–180°', () => {
    expect(snapAngle((44 * Math.PI) / 180)).toBeCloseTo(Math.PI / 4);
    expect(snapAngle((40 * Math.PI) / 180)).toBeCloseTo((40 * Math.PI) / 180);
    expect(displayDegrees((190 * Math.PI) / 180)).toBe(10);
  });
});
