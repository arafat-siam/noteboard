import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../db/db';
import { isVisible } from '../db/library';
import type { Folder, ID, LibraryItem } from '../model/types';
import { sync } from '../sync/instance';

export interface LibraryState {
  all: LibraryItem[];
  byId: Map<ID, LibraryItem>;
  visible: LibraryItem[];
  folders: Folder[];
  tags: string[];
  trashed: LibraryItem[];
}

export function useLibrary(): LibraryState | undefined {
  const items = useLiveQuery(() => db.items.toArray(), []);
  return useMemo(() => {
    if (!items) return undefined;
    const byId = new Map(items.map((i) => [i.id, i]));
    const visible = items.filter((i) => isVisible(byId, i.id));
    const folders = visible.filter((i): i is Folder => i.kind === 'folder');
    const tags = [...new Set(visible.flatMap((i) => (i.kind === 'notebook' ? i.tags : [])))].sort((a, b) =>
      a.localeCompare(b),
    );
    // Trash shows what the user trashed, not every item inside a trashed folder.
    const trashed = items
      .filter((i) => !i.deleted && i.trashedAt)
      .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
    return { all: items, byId, visible, folders, tags, trashed };
  }, [items]);
}

/** Runs a library action, reports failures, and schedules a Drive sync. */
export async function act(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
    sync.syncSoon();
  } catch (error) {
    alert(error instanceof Error ? error.message : String(error));
  }
}

export function pathOf(byId: Map<ID, LibraryItem>, item: LibraryItem): string {
  const names: string[] = [];
  let current = item.parentId;
  const seen = new Set<ID>();
  while (current && !seen.has(current)) {
    const parent = byId.get(current);
    if (!parent) break;
    names.unshift(parent.name);
    seen.add(current);
    current = parent.parentId;
  }
  return ['Library', ...names].join(' › ');
}
