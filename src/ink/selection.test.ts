import { describe, expect, it } from 'vitest';
import type { Stroke } from '../model/types';
import { strokeBounds } from './geometry';
import { alignStrokes, distributeStrokes, expandGroups, flipStrokes, regroup, setLocked, snapMove } from './selection';

const line = (id: string, x: number, y: number, w = 20, extra: Partial<Stroke> = {}): Stroke => ({
  id, tool: 'pen', color: '#000', size: 2, hasPressure: true, createdAt: 1, points: [x, y, 0.5, x + w, y, 0.5], ...extra,
});

describe('selection helpers', () => {
  it('selects whole groups', () => {
    const strokes = [line('a', 0, 0, 20, { group: 'g' }), line('b', 50, 0, 20, { group: 'g' }), line('c', 100, 0)];
    expect([...expandGroups(strokes, ['a'])].sort()).toEqual(['a', 'b']);
    expect([...expandGroups(strokes, ['c'])]).toEqual(['c']);
  });

  it('aligns left edges and keeps layers', () => {
    const out = alignStrokes([line('a', 10, 0), line('b', 40, 30, 20, { createdAt: 7 })], 'left');
    expect(out.before.map((s) => s.id)).toEqual(['b']);
    expect(strokeBounds(out.after[0]!).x).toBeCloseTo(strokeBounds(line('a', 10, 0)).x);
    expect(out.after[0]!.createdAt).toBe(7);
  });

  it('distributes with equal gaps', () => {
    const out = distributeStrokes([line('a', 0, 0), line('b', 30, 0), line('c', 100, 0)], 'horizontal');
    expect(out.before.map((s) => s.id)).toEqual(['b']);
    const moved = out.after[0]!;
    // a spans 0..20, c 100..120: b (20 wide) goes to 50..70
    expect(moved.points[0]).toBeCloseTo(50);
  });

  it('flips ink around the selection middle', () => {
    const [f] = flipStrokes([line('a', 0, 0, 20)], 'horizontal');
    expect(f!.points[0]).toBeCloseTo(20);
    expect(f!.points[3]).toBeCloseTo(0);
  });

  it('groups, ungroups, locks and unlocks as new items (never edits in place)', () => {
    const [g] = regroup([line('a', 0, 0)], 'grp');
    expect(g!.group).toBe('grp');
    expect(g!.id).not.toBe('a');
    expect('group' in regroup([g!], null)[0]!).toBe(false);
    const [l] = setLocked([line('a', 0, 0)], true);
    expect(l!.locked).toBe(true);
    expect('locked' in setLocked([l!], false)[0]!).toBe(false);
  });

  it('snaps a moving selection to nearby edges', () => {
    const r = snapMove({ x: 0, y: 0, width: 10, height: 10 }, { x: 47, y: 3 }, { xs: [50], ys: [100] }, 5);
    // The centre (at 52) is closer to 50 than the left edge (at 47): the centre snaps.
    expect(r.offset).toEqual({ x: 45, y: 3 });
    expect(r.guides).toEqual([{ axis: 'x', at: 50 }]);
  });
});
