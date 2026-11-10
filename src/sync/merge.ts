import type { LibraryItem, Page } from '../model/types';

/**
 * Merges two copies of a page without losing ink from either device.
 * Strokes are immutable and identified by id, so the merge is a set union minus
 * erased ids (tombstones). Page settings use last-writer-wins.
 */
export function mergePage(local: Page, remote: Page): Page {
  const tombstones = new Set([...local.deletedStrokeIds, ...remote.deletedStrokeIds]);
  const byId = new Map<string, Page['strokes'][number]>();
  for (const s of remote.strokes) if (!tombstones.has(s.id)) byId.set(s.id, s);
  for (const s of local.strokes) if (!tombstones.has(s.id)) byId.set(s.id, s);
  const strokes = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const newer = local.updatedAt >= remote.updatedAt ? local : remote;
  return {
    ...newer,
    strokes,
    deletedStrokeIds: [...tombstones].sort(),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
}

/** Same ink, tombstones and settings (ignores sync bookkeeping). */
export function samePageContent(a: Page, b: Page): boolean {
  if (a.template !== b.template || a.strokes.length !== b.strokes.length) return false;
  if (a.deletedStrokeIds.length !== b.deletedStrokeIds.length) return false;
  const ids = new Set(a.strokes.map((s) => s.id));
  if (!b.strokes.every((s) => ids.has(s.id))) return false;
  const tomb = new Set(a.deletedStrokeIds);
  return b.deletedStrokeIds.every((id) => tomb.has(id));
}

export interface LibraryMergeResult {
  merged: LibraryItem[];
  /** Remote had newer data; local database must be updated. */
  localChanged: boolean;
  /** Local had newer data; library.json must be uploaded. */
  remoteChanged: boolean;
}

/** Per-item last-writer-wins. Permanent deletion is sticky so purged items never come back. */
export function mergeLibrary(local: LibraryItem[], remote: LibraryItem[]): LibraryMergeResult {
  const localById = new Map(local.map((i) => [i.id, i]));
  const remoteById = new Map(remote.map((i) => [i.id, i]));
  const merged: LibraryItem[] = [];
  let localChanged = false;
  let remoteChanged = false;

  for (const id of new Set([...localById.keys(), ...remoteById.keys()])) {
    const l = localById.get(id);
    const r = remoteById.get(id);
    if (!r) {
      merged.push(l!);
      remoteChanged = true;
      continue;
    }
    if (!l) {
      merged.push(r);
      localChanged = true;
      continue;
    }
    let winner: LibraryItem = l.updatedAt >= r.updatedAt ? l : r;
    if (winner.kind === 'notebook' && l.kind === 'notebook' && r.kind === 'notebook') {
      const loser = winner === l ? r : l;
      // Pages added on either device are kept; pages deleted on either device stay deleted.
      const deletedPageIds = [...new Set([...l.deletedPageIds, ...r.deletedPageIds])].sort();
      const removed = new Set(deletedPageIds);
      const pageIds = [...new Set([...winner.pageIds, ...loser.pageIds])].filter((id) => !removed.has(id));
      // lastOpenedAt is a local convenience; keep this device's value.
      winner = { ...winner, pageIds, deletedPageIds, lastOpenedAt: l.lastOpenedAt };
    }
    if ((l.deleted || r.deleted) && !winner.deleted) {
      winner = { ...winner, deleted: true, updatedAt: Math.max(l.updatedAt, r.updatedAt) };
    }
    if (!sameItem(winner, l)) localChanged = true;
    if (!sameItem(winner, r)) remoteChanged = true;
    merged.push(winner);
  }
  return { merged, localChanged, remoteChanged };
}

function sameItem(a: LibraryItem, b: LibraryItem): boolean {
  const strip = (i: LibraryItem) => (i.kind === 'notebook' ? { ...i, lastOpenedAt: null } : i);
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}
