import { insertPages, removePages } from './pages';
import type { NoteboardDB } from './db';
import {
  COVER_COLORS,
  FOLDER_COLORS,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  newId,
  type Folder,
  type ID,
  type LibraryItem,
  type Notebook,
  type Page,
  type PaperTemplate,
  type NotebookSettings,
  type Recording,
} from '../model/types';

export const TRASH_RETENTION_DAYS = 30;

export class LibraryError extends Error {}

/** Bumps the library revision so the sync engine knows library.json must be uploaded. */
export async function markLibraryChanged(db: NoteboardDB): Promise<void> {
  const rev = (await db.getMeta<number>('libraryRev')) ?? 0;
  await db.setMeta('libraryRev', rev + 1);
}

function cleanName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new LibraryError('Name cannot be empty.');
  return trimmed.slice(0, 120);
}

export function blankPage(
  notebookId: ID,
  template: PaperTemplate,
  now = Date.now(),
  size: { width: number; height: number } = { width: PAGE_WIDTH, height: PAGE_HEIGHT },
): Page {
  return {
    id: newId(),
    notebookId,
    template,
    width: size.width,
    height: size.height,
    strokes: [],
    deletedStrokeIds: [],
    updatedAt: now,
    dirty: 1,
  };
}

export async function createFolder(db: NoteboardDB, name: string, parentId: ID | null): Promise<Folder> {
  const now = Date.now();
  const folder: Folder = {
    kind: 'folder',
    id: newId(),
    parentId,
    name: cleanName(name),
    color: FOLDER_COLORS[0]!,
    createdAt: now,
    updatedAt: now,
    trashedAt: null,
    favorite: false,
    deleted: false,
  };
  await db.transaction('rw', db.items, db.meta, async () => {
    await db.items.add(folder);
    await markLibraryChanged(db);
  });
  return folder;
}

export async function createNotebook(
  db: NoteboardDB,
  name: string,
  parentId: ID | null,
  template: PaperTemplate = 'ruled',
  coverColor: string = COVER_COLORS[0]!,
  size?: { width: number; height: number },
): Promise<Notebook> {
  const now = Date.now();
  const id = newId();
  const page = blankPage(id, template, now, size);
  const notebook: Notebook = {
    kind: 'notebook',
    id,
    parentId,
    name: cleanName(name),
    coverColor,
    template,
    pageIds: [page.id],
    deletedPageIds: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null,
    trashedAt: null,
    favorite: false,
    deleted: false,
  };
  await db.transaction('rw', db.items, db.pages, db.strokes, db.meta, async () => {
    await db.items.add(notebook);
    await insertPages(db, [page]);
    await markLibraryChanged(db);
  });
  return notebook;
}

async function updateItem(db: NoteboardDB, id: ID, change: (item: LibraryItem) => void): Promise<void> {
  await db.transaction('rw', db.items, db.meta, async () => {
    const item = await db.items.get(id);
    if (!item) throw new LibraryError('Item not found.');
    change(item);
    item.updatedAt = Date.now();
    await db.items.put(item);
    await markLibraryChanged(db);
  });
}

export function renameItem(db: NoteboardDB, id: ID, name: string): Promise<void> {
  const clean = cleanName(name);
  return updateItem(db, id, (item) => {
    item.name = clean;
  });
}

export function setFavorite(db: NoteboardDB, id: ID, favorite: boolean): Promise<void> {
  return updateItem(db, id, (item) => {
    item.favorite = favorite;
  });
}

export function setColor(db: NoteboardDB, id: ID, color: string): Promise<void> {
  return updateItem(db, id, (item) => {
    if (item.kind === 'folder') item.color = color;
    else item.coverColor = color;
  });
}

/** Changes notebook settings; `undefined` removes a setting (back to the default). */
export function setNotebookSettings(db: NoteboardDB, id: ID, patch: NotebookSettings): Promise<void> {
  return updateItem(db, id, (item) => {
    if (item.kind !== 'notebook') return;
    const target = item as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete target[key];
      else target[key] = value;
    }
  });
}

export function setTags(db: NoteboardDB, id: ID, tags: string[]): Promise<void> {
  const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  return updateItem(db, id, (item) => {
    if (item.kind === 'notebook') item.tags = clean;
  });
}

export function markOpened(db: NoteboardDB, id: ID): Promise<void> {
  return db.transaction('rw', db.items, async () => {
    const item = await db.items.get(id);
    if (item?.kind === 'notebook') {
      item.lastOpenedAt = Date.now();
      await db.items.put(item); // local-only convenience; not worth a sync
    }
  });
}

/** True if `id` is `ancestorId` or lives anywhere beneath it. */
export function isWithin(items: Map<ID, LibraryItem>, id: ID | null, ancestorId: ID): boolean {
  let current = id;
  const seen = new Set<ID>();
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = items.get(current)?.parentId ?? null;
  }
  return false;
}

export async function moveItems(db: NoteboardDB, ids: ID[], targetFolderId: ID | null): Promise<void> {
  await db.transaction('rw', db.items, db.meta, async () => {
    const all = new Map((await db.items.toArray()).map((i) => [i.id, i]));
    if (targetFolderId) {
      const target = all.get(targetFolderId);
      if (!target || target.kind !== 'folder' || target.deleted) throw new LibraryError('Folder not found.');
    }
    const now = Date.now();
    for (const id of ids) {
      const item = all.get(id);
      if (!item) continue;
      if (item.kind === 'folder' && isWithin(all, targetFolderId, id)) {
        throw new LibraryError(`Can't move "${item.name}" into itself.`);
      }
      if (item.parentId === targetFolderId) continue;
      item.parentId = targetFolderId;
      item.updatedAt = now;
      await db.items.put(item);
    }
    await markLibraryChanged(db);
  });
}

export async function trashItems(db: NoteboardDB, ids: ID[]): Promise<void> {
  await db.transaction('rw', db.items, db.meta, async () => {
    const now = Date.now();
    for (const id of ids) {
      const item = await db.items.get(id);
      if (!item || item.trashedAt) continue;
      item.trashedAt = now;
      item.updatedAt = now;
      await db.items.put(item);
    }
    await markLibraryChanged(db);
  });
}

/** Restores to the original folder, or to the library root if that folder is gone or trashed. */
export async function restoreItem(db: NoteboardDB, id: ID): Promise<void> {
  await db.transaction('rw', db.items, db.meta, async () => {
    const all = new Map((await db.items.toArray()).map((i) => [i.id, i]));
    const item = all.get(id);
    if (!item) return;
    if (item.parentId && !isVisible(all, item.parentId)) item.parentId = null;
    item.trashedAt = null;
    item.updatedAt = Date.now();
    await db.items.put(item);
    await markLibraryChanged(db);
  });
}

/** Permanently deletes an item and everything inside it. */
export async function purgeItems(db: NoteboardDB, ids: ID[]): Promise<void> {
  await db.transaction('rw', db.items, db.pages, db.strokes, db.meta, async () => {
    const all = await db.items.toArray();
    const byId = new Map(all.map((i) => [i.id, i]));
    const now = Date.now();
    for (const item of all) {
      if (item.deleted || !ids.some((id) => isWithin(byId, item.id, id))) continue;
      item.deleted = true;
      item.updatedAt = now;
      if (item.kind === 'notebook') {
        await removePages(db, (await db.pages.where('notebookId').equals(item.id).primaryKeys()) as ID[]);
        item.pageIds = [];
      }
      await db.items.put(item);
    }
    await markLibraryChanged(db);
  });
}

export async function purgeExpiredTrash(db: NoteboardDB, now = Date.now()): Promise<number> {
  const cutoff = now - TRASH_RETENTION_DAYS * 86_400_000;
  const expired = (await db.items.toArray()).filter((i) => !i.deleted && i.trashedAt && i.trashedAt < cutoff);
  if (expired.length) await purgeItems(db, expired.map((i) => i.id));
  return expired.length;
}

/** Not deleted, not trashed, and no trashed folder above it. */
export function isVisible(items: Map<ID, LibraryItem>, id: ID): boolean {
  let current: ID | null = id;
  const seen = new Set<ID>();
  while (current && !seen.has(current)) {
    const item = items.get(current);
    if (!item || item.deleted || item.trashedAt) return false;
    seen.add(current);
    current = item.parentId;
  }
  return true;
}

export function ancestors(items: Map<ID, LibraryItem>, folderId: ID | null): Folder[] {
  const chain: Folder[] = [];
  let current = folderId;
  const seen = new Set<ID>();
  while (current && !seen.has(current)) {
    const item = items.get(current);
    if (!item || item.kind !== 'folder') break;
    chain.unshift(item);
    seen.add(current);
    current = item.parentId;
  }
  return chain;
}

export type SortKey = 'name' | 'updated' | 'created';

export function sortItems(list: LibraryItem[], key: SortKey): LibraryItem[] {
  return [...list].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    switch (key) {
      case 'name':
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'updated':
        return b.updatedAt - a.updatedAt;
      case 'created':
        return b.createdAt - a.createdAt;
    }
  });
}

export interface PageSpec {
  width: number;
  height: number;
  template?: PaperTemplate;
  background?: Page['background'];
}

/** Creates a notebook with the given pages (used by PDF import). */
export async function createNotebookFromPages(
  db: NoteboardDB,
  name: string,
  parentId: ID | null,
  specs: PageSpec[],
  coverColor: string = COVER_COLORS[2]!,
): Promise<Notebook> {
  const now = Date.now();
  const id = newId();
  const pages: Page[] = specs.map((spec) => ({
    ...blankPage(id, spec.template ?? 'blank', now),
    width: spec.width,
    height: spec.height,
    ...(spec.background ? { background: spec.background } : {}),
  }));
  const notebook: Notebook = {
    kind: 'notebook',
    id,
    parentId,
    name: cleanName(name),
    coverColor,
    template: 'blank',
    pageIds: pages.map((p) => p.id),
    deletedPageIds: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null,
    trashedAt: null,
    favorite: false,
    deleted: false,
  };
  await db.transaction('rw', db.items, db.pages, db.strokes, db.meta, async () => {
    await db.items.add(notebook);
    await insertPages(db, pages);
    await markLibraryChanged(db);
  });
  return notebook;
}

/** Saves a finished recording: the audio goes to the files table (synced), the entry to the notebook. */
export async function addRecording(
  db: NoteboardDB,
  notebookId: ID,
  audio: Blob,
  durationMs: number,
  name: string,
  /** The id the ink written during the recording was stamped with. */
  id: ID = newId(),
): Promise<Recording> {
  const fileId = newId();
  const recording: Recording = { id, fileId, name, createdAt: Date.now(), durationMs };
  await db.files.put({ id: fileId, name: `${name}.audio`, mime: audio.type || 'audio/mp4', size: audio.size, data: audio, createdAt: Date.now(), uploaded: 0 });
  await updateItem(db, notebookId, (item) => {
    if (item.kind === 'notebook') item.recordings = [...(item.recordings ?? []), recording];
  });
  return recording;
}

export function renameRecording(db: NoteboardDB, notebookId: ID, recordingId: ID, name: string): Promise<void> {
  const clean = name.trim().slice(0, 120) || 'Recording';
  return updateItem(db, notebookId, (item) => {
    if (item.kind === 'notebook') item.recordings = (item.recordings ?? []).map((r) => (r.id === recordingId ? { ...r, name: clean } : r));
  });
}

/** Removes a recording (ink keeps its stamps; they're simply ignored). */
export async function deleteRecording(db: NoteboardDB, notebookId: ID, recordingId: ID): Promise<void> {
  let fileId: ID | undefined;
  await updateItem(db, notebookId, (item) => {
    if (item.kind !== 'notebook') return;
    fileId = item.recordings?.find((r) => r.id === recordingId)?.fileId;
    item.recordings = (item.recordings ?? []).filter((r) => r.id !== recordingId);
    item.deletedRecordingIds = [...new Set([...(item.deletedRecordingIds ?? []), recordingId])];
  });
  if (fileId) await db.files.delete(fileId);
}
