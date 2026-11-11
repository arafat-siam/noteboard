import { newId, type ID, type Stroke } from '../model/types';
import { strokeBounds, type Rect } from './geometry';

/**
 * Layering ("Arrange"): Bring to Front, Bring Forward, Send Backward, Send to Back.
 *
 * Items are drawn in createdAt order (oldest at the back). Strokes are immutable, so moving an
 * item in the stack makes a copy with a new id and a new createdAt and erases the original —
 * exactly like moving it on the page. That keeps sync and undo working unchanged.
 */
export type ArrangeAction = 'front' | 'forward' | 'backward' | 'back';

const byStack = (a: Stroke, b: Stroke) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

const overlaps = (a: Rect, b: Rect) =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

export function arrange(
  strokes: Stroke[],
  selectedIds: ReadonlySet<ID>,
  action: ArrangeAction,
  makeId: () => ID = newId,
): { added: Stroke[]; removedIds: ID[] } | null {
  const order = [...strokes].sort(byStack);
  const selected = order.filter((s) => selectedIds.has(s.id));
  const others = order.filter((s) => !selectedIds.has(s.id));
  if (!selected.length || !others.length) return null;

  const box = selected.map(strokeBounds).reduce((a, b) => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
  });
  const k = selected.length;
  let times: number[];

  if (action === 'front') {
    const top = order[order.length - 1]!.createdAt;
    if (selected.every((s, i) => s === order[order.length - k + i])) return null; // already in front
    times = selected.map((_, i) => top + i + 1);
  } else if (action === 'back') {
    const bottom = order[0]!.createdAt;
    if (selected.every((s, i) => s === order[i])) return null;
    times = selected.map((_, i) => bottom - k + i);
  } else if (action === 'forward') {
    // Just above the next item in front of the selection that it overlaps.
    const topIndex = order.indexOf(selected[k - 1]!);
    const above = order.slice(topIndex + 1).filter((s) => !selectedIds.has(s.id));
    const pass = above.find((s) => overlaps(strokeBounds(s), box)) ?? above[0];
    if (!pass) return null;
    const next = order[order.indexOf(pass) + 1];
    const low = pass.createdAt;
    const high = next && !selectedIds.has(next.id) ? next.createdAt : low + k + 1;
    const gap = high > low ? high - low : 1;
    times = selected.map((_, i) => low + (gap * (i + 1)) / (k + 1));
  } else {
    // Just below the next item behind the selection that it overlaps.
    const bottomIndex = order.indexOf(selected[0]!);
    const below = order.slice(0, bottomIndex).filter((s) => !selectedIds.has(s.id));
    const pass = [...below].reverse().find((s) => overlaps(strokeBounds(s), box)) ?? below[below.length - 1];
    if (!pass) return null;
    const prev = order[order.indexOf(pass) - 1];
    const high = pass.createdAt;
    const low = prev && !selectedIds.has(prev.id) ? prev.createdAt : high - k - 1;
    const gap = high > low ? high - low : 1;
    times = selected.map((_, i) => high - gap + (gap * (i + 1)) / (k + 1));
  }

  const added = selected.map((s, i) => ({ ...s, id: makeId(), createdAt: times[i]! }));
  return { added, removedIds: selected.map((s) => s.id) };
}
