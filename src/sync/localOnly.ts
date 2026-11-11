import type { NoteboardDB } from '../db/db';
import { markLibraryChanged } from '../db/library';
import type { ID, LibraryItem } from '../model/types';

/**
 * "Keep on this iPad only": notebooks/folders this device never uploads to Google Drive.
 * Stored per device (not synced), so marking something private never broadcasts it.
 */
const KEY = 'localOnlyIds';
const REMOVAL_QUEUE = 'driveRemovalQueue';

export async function getLocalOnlyRoots(db: NoteboardDB): Promise<Set<ID>> {
  return new Set((await db.getMeta<ID[]>(KEY)) ?? []);
}

/** The marked items plus everything inside marked folders. */
export function expandLocalOnly(items: LibraryItem[], roots: ReadonlySet<ID>): Set<ID> {
  if (!roots.size) return new Set();
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = new Set<ID>();
  for (const item of items) {
    let current: LibraryItem | undefined = item;
    const seen = new Set<ID>();
    while (current && !seen.has(current.id)) {
      if (roots.has(current.id)) {
        out.add(item.id);
        break;
      }
      seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return out;
}

export async function setLocalOnly(db: NoteboardDB, id: ID, localOnly: boolean): Promise<void> {
  await db.transaction('rw', [db.meta, db.items, db.pages, db.files, db.sync], async () => {
    const roots = await getLocalOnlyRoots(db);
    if (localOnly) {
      roots.add(id);
      // Ask the next sync to take any existing copy out of Google Drive.
      const queue = new Set((await db.getMeta<ID[]>(REMOVAL_QUEUE)) ?? []);
      queue.add(id);
      await db.setMeta(REMOVAL_QUEUE, [...queue]);
    } else {
      roots.delete(id);
      // Upload everything inside again.
      const items = await db.items.toArray();
      const inside = expandLocalOnly(items, new Set([id]));
      const notebookIds = items.filter((i) => inside.has(i.id) && i.kind === 'notebook').map((i) => i.id);
      if (notebookIds.length) {
        const pages = await db.pages.where('notebookId').anyOf(notebookIds).toArray();
        await db.pages.where('notebookId').anyOf(notebookIds).modify({ dirty: 1 });
        for (const fileId of new Set(pages.map((p) => p.background?.fileId).filter((f): f is ID => !!f))) {
          if (!(await db.sync.get(`file_${fileId}`))) await db.files.update(fileId, { uploaded: 0 });
        }
      }
    }
    await db.setMeta(KEY, [...roots]);
    await markLibraryChanged(db);
  });
}

export async function takeRemovalQueue(db: NoteboardDB): Promise<ID[]> {
  const queue = (await db.getMeta<ID[]>(REMOVAL_QUEUE)) ?? [];
  return queue;
}

export async function clearRemovalQueue(db: NoteboardDB, done: ID[]): Promise<void> {
  const queue = ((await db.getMeta<ID[]>(REMOVAL_QUEUE)) ?? []).filter((id) => !done.includes(id));
  await db.setMeta(REMOVAL_QUEUE, queue);
}
