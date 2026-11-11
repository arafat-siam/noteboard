import { newId, type Page, type Stroke } from '../model/types';
import { boundsOf, strokePoints, type Point } from './geometry';

/**
 * Noteboard's own clipboard: copied ink / pictures, or copied pages. It works across notebooks
 * (copy here, open another notebook, paste) and survives a reload for this browser tab.
 * Pictures on the clipboard refer to files already stored on this device.
 */
export type Clip = { kind: 'ink'; strokes: Stroke[] } | { kind: 'pages'; pages: Page[] };

const KEY = 'noteboard.clipboard';
let current: Clip | null = null;
const listeners = new Set<() => void>();

try {
  const saved = sessionStorage.getItem(KEY);
  if (saved) current = JSON.parse(saved) as Clip;
} catch {
  current = null;
}

export function getClip(): Clip | null {
  return current;
}

export function setClip(clip: Clip): void {
  current = clip;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(clip));
  } catch {
    // Too big for session storage (many pages): still works until the app is reloaded.
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* storage unavailable */
    }
  }
  for (const l of listeners) l();
}

export function onClipChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Copies of the clipboard ink for pasting: new ids, on top of everything (keeping their own
 * order), centred on `at` — or offset a little from where they were copied if `at` is null.
 */
export function inkForPaste(strokes: Stroke[], at: Point | null, now = Date.now()): Stroke[] {
  if (!strokes.length) return [];
  const b = boundsOf(strokes.flatMap(strokePoints));
  const dx = at ? at.x - (b.x + b.width / 2) : 24;
  const dy = at ? at.y - (b.y + b.height / 2) : 24;
  const ordered = [...strokes].sort((a, c) => a.createdAt - c.createdAt || a.id.localeCompare(c.id));
  return ordered.map((s, i) => {
    const points = s.points.slice();
    for (let j = 0; j + 1 < points.length; j += 3) {
      points[j] = points[j]! + dx;
      points[j + 1] = points[j + 1]! + dy;
    }
    return { ...s, id: newId(), points, createdAt: now + i / 1000 };
  });
}
