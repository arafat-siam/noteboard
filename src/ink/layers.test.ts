import { describe, expect, it } from 'vitest';
import type { Stroke } from '../model/types';
import { arrange } from './layers';

const box = (id: string, createdAt: number, x = 0): Stroke => ({
  id,
  tool: 'pen',
  color: '#000',
  size: 2,
  hasPressure: false,
  createdAt,
  points: [x, 0, 0.5, x + 50, 50, 0.5],
});

/** Applies an arrange result and returns the ids bottom → top. */
function stack(strokes: Stroke[], ids: string[], action: Parameters<typeof arrange>[2]) {
  let n = 0;
  const r = arrange(strokes, new Set(ids), action, () => `n${++n}`);
  if (!r) return null;
  const removed = new Set(r.removedIds);
  const next = [...strokes.filter((s) => !removed.has(s.id)), ...r.added].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  // Report new copies by the id they replaced.
  const original = new Map(r.added.map((s, i) => [s.id, r.removedIds[i]!]));
  return next.map((s) => original.get(s.id) ?? s.id);
}

describe('layering', () => {
  const page = [box('a', 1), box('b', 2), box('c', 3), box('d', 4)];

  it('brings to front and sends to back', () => {
    expect(stack(page, ['b'], 'front')).toEqual(['a', 'c', 'd', 'b']);
    expect(stack(page, ['c'], 'back')).toEqual(['c', 'a', 'b', 'd']);
  });

  it('moves one step forward or backward', () => {
    expect(stack(page, ['b'], 'forward')).toEqual(['a', 'c', 'b', 'd']);
    expect(stack(page, ['c'], 'backward')).toEqual(['a', 'c', 'b', 'd']);
  });

  it('keeps the order within a multi-item selection', () => {
    expect(stack(page, ['a', 'b'], 'front')).toEqual(['c', 'd', 'a', 'b']);
    expect(stack(page, ['c', 'd'], 'back')).toEqual(['c', 'd', 'a', 'b']);
  });

  it('steps past the next item it actually overlaps', () => {
    const spread = [box('a', 1), box('far', 2, 500), box('b', 3), box('c', 4)];
    // 'far' doesn't overlap 'a', so one step forward goes past 'b' (the next overlapping item).
    expect(stack(spread, ['a'], 'forward')).toEqual(['far', 'b', 'a', 'c']);
  });

  it('does nothing when already at the front or back', () => {
    expect(arrange(page, new Set(['d']), 'front')).toBeNull();
    expect(arrange(page, new Set(['a']), 'back')).toBeNull();
    expect(arrange(page, new Set(['d']), 'forward')).toBeNull();
  });
});
