import { newId, type Stroke } from '../model/types';
import { strokeBounds, translateStroke, unionRects, type Point, type Rect } from './geometry';

/**
 * Selection helpers (pure, tested): locked items, groups, align / distribute, flip, and the
 * smart guides a moving selection snaps to.
 */

/** Locked items (Drawboard-style) can't be selected, moved or erased until unlocked. */
export const isSelectable = (s: Stroke) => !s.locked;

/** What the lasso's "select only" filter calls each item. */
export type ItemKind = 'ink' | 'highlighter' | 'text' | 'pictures' | 'tape';
export const ITEM_KINDS: { kind: ItemKind; label: string }[] = [
  { kind: 'ink', label: 'Ink & shapes' },
  { kind: 'highlighter', label: 'Highlighter' },
  { kind: 'text', label: 'Text' },
  { kind: 'pictures', label: 'Pictures' },
  { kind: 'tape', label: 'Tape' },
];
export function kindOf(s: Stroke): ItemKind {
  return s.tool === 'image' ? 'pictures' : s.tool === 'text' ? 'text' : s.tool === 'tape' ? 'tape' : s.tool === 'highlighter' ? 'highlighter' : 'ink';
}

/** Adds every member of any group that is partly selected (groups always select together). */
export function expandGroups(strokes: Stroke[], ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  const groups = new Set<string>();
  for (const s of strokes) if (out.has(s.id) && s.group) groups.add(s.group);
  if (groups.size) for (const s of strokes) if (s.group && groups.has(s.group)) out.add(s.id);
  return out;
}

/** The items as units: a group moves as one, every other item on its own. */
function units(strokes: Stroke[]): { members: Stroke[]; bounds: Rect }[] {
  const byGroup = new Map<string, Stroke[]>();
  const out: { members: Stroke[]; bounds: Rect }[] = [];
  for (const s of strokes) {
    if (s.group) {
      const list = byGroup.get(s.group) ?? [];
      list.push(s);
      byGroup.set(s.group, list);
    } else out.push({ members: [s], bounds: strokeBounds(s) });
  }
  for (const members of byGroup.values()) out.push({ members, bounds: unionRects(members.map(strokeBounds))! });
  return out;
}

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** The items that move (`before`) and their moved copies (`after`: new ids, same layer). */
export interface Moved {
  before: Stroke[];
  after: Stroke[];
}

/** Aligns the given items (groups move as one). */
export function alignStrokes(strokes: Stroke[], mode: AlignMode): Moved {
  const list = units(strokes);
  const all = unionRects(list.map((u) => u.bounds));
  const out: Moved = { before: [], after: [] };
  if (!all || list.length < 2) return out;
  for (const u of list) {
    const b = u.bounds;
    const dx =
      mode === 'left' ? all.x - b.x : mode === 'right' ? all.x + all.width - (b.x + b.width) : mode === 'center' ? all.x + all.width / 2 - (b.x + b.width / 2) : 0;
    const dy =
      mode === 'top' ? all.y - b.y : mode === 'bottom' ? all.y + all.height - (b.y + b.height) : mode === 'middle' ? all.y + all.height / 2 - (b.y + b.height / 2) : 0;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;
    for (const s of u.members) {
      out.before.push(s);
      out.after.push({ ...translateStroke(s, dx, dy, newId()), createdAt: s.createdAt });
    }
  }
  return out;
}

/** Equal gaps between items, left to right ('horizontal') or top to bottom. */
export function distributeStrokes(strokes: Stroke[], axis: 'horizontal' | 'vertical'): Moved {
  const list = units(strokes);
  const out: Moved = { before: [], after: [] };
  if (list.length < 3) return out;
  const h = axis === 'horizontal';
  const start = (r: Rect) => (h ? r.x : r.y);
  const size = (r: Rect) => (h ? r.width : r.height);
  list.sort((a, b) => start(a.bounds) - start(b.bounds));
  const first = list[0]!.bounds;
  const last = list[list.length - 1]!.bounds;
  const span = start(last) + size(last) - start(first);
  const total = list.reduce((sum, u) => sum + size(u.bounds), 0);
  const gap = (span - total) / (list.length - 1);
  let at = start(first);
  for (const u of list) {
    const d = at - start(u.bounds);
    at += size(u.bounds) + gap;
    if (Math.abs(d) < 0.01) continue;
    for (const s of u.members) {
      out.before.push(s);
      out.after.push({ ...translateStroke(s, h ? d : 0, h ? 0 : d, newId()), createdAt: s.createdAt });
    }
  }
  return out;
}

/**
 * Mirrored copies, about the middle of all the items. Text stays readable: its box moves to the
 * mirrored place but the letters aren't flipped.
 */
export function flipStrokes(strokes: Stroke[], axis: 'horizontal' | 'vertical'): Stroke[] {
  const all = unionRects(strokes.map(strokeBounds));
  if (!all) return [];
  const cx = all.x + all.width / 2;
  const cy = all.y + all.height / 2;
  return strokes.map((s) => {
    if (s.tool === 'text') {
      const b = strokeBounds(s);
      const dx = axis === 'horizontal' ? 2 * cx - (b.x + b.width / 2) - (b.x + b.width / 2) : 0;
      const dy = axis === 'vertical' ? 2 * cy - (b.y + b.height / 2) - (b.y + b.height / 2) : 0;
      return { ...translateStroke(s, dx, dy, newId()), createdAt: s.createdAt };
    }
    const points = s.points.slice();
    for (let i = 0; i + 1 < points.length; i += 3) {
      if (axis === 'horizontal') points[i] = 2 * cx - points[i]!;
      else points[i + 1] = 2 * cy - points[i + 1]!;
    }
    return { ...s, id: newId(), points };
  });
}

/** Same items, now one group (or ungrouped with `null`). */
export function regroup(strokes: Stroke[], group: string | null): Stroke[] {
  return strokes.map((s) => {
    const { group: _g, ...rest } = s;
    return group ? { ...rest, id: newId(), group } : { ...rest, id: newId() };
  });
}

/** Same items, locked or unlocked. */
export function setLocked(strokes: Stroke[], locked: boolean): Stroke[] {
  return strokes.map((s) => {
    const { locked: _l, ...rest } = s;
    return locked ? { ...rest, id: newId(), locked: true } : { ...rest, id: newId() };
  });
}

// ---- Smart guides ------------------------------------------------------------------------

export interface Guide {
  /** 'x' = a vertical line at `at`; 'y' = a horizontal line. */
  axis: 'x' | 'y';
  at: number;
}

/** Lines a moving selection can line up with: page edges and centre, and other items' edges and centres. */
export function guideTargets(strokes: Stroke[], ignore: ReadonlySet<string>, page: { width: number; height: number }): { xs: number[]; ys: number[] } {
  const xs = [0, page.width / 2, page.width];
  const ys = [0, page.height / 2, page.height];
  for (const s of strokes) {
    if (ignore.has(s.id)) continue;
    const b = strokeBounds(s);
    xs.push(b.x, b.x + b.width / 2, b.x + b.width);
    ys.push(b.y, b.y + b.height / 2, b.y + b.height);
  }
  return { xs, ys };
}

/**
 * Nudges a move so the selection's edges or centre line up with a target when within
 * `threshold`; returns the adjusted offset and the guides to draw.
 */
export function snapMove(bounds: Rect, offset: Point, targets: { xs: number[]; ys: number[] }, threshold: number): { offset: Point; guides: Guide[] } {
  const pick = (edges: number[], candidates: number[]) => {
    let best: { d: number; at: number } | null = null;
    for (const e of edges)
      for (const c of candidates) {
        const d = c - e;
        if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: c };
      }
    return best;
  };
  const x0 = bounds.x + offset.x;
  const y0 = bounds.y + offset.y;
  const bx = pick([x0, x0 + bounds.width / 2, x0 + bounds.width], targets.xs);
  const by = pick([y0, y0 + bounds.height / 2, y0 + bounds.height], targets.ys);
  const guides: Guide[] = [];
  if (bx) guides.push({ axis: 'x', at: bx.at });
  if (by) guides.push({ axis: 'y', at: by.at });
  return { offset: { x: offset.x + (bx?.d ?? 0), y: offset.y + (by?.d ?? 0) }, guides };
}

// ---- "Keep proportions" preference (corner handles), remembered on this device ------------
const ASPECT_KEY = 'noteboard.keepAspect';
export function getKeepAspect(): boolean {
  try {
    return localStorage.getItem(ASPECT_KEY) !== '0';
  } catch {
    return true;
  }
}
export function setKeepAspect(on: boolean): void {
  try {
    localStorage.setItem(ASPECT_KEY, on ? '1' : '0');
  } catch {
    /* private mode */
  }
}
