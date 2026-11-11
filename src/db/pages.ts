import type { NoteboardDB, PageRecord, StoredStroke } from './db';
import { markLibraryChanged, blankPage } from './library';
import type { ID, Page, PaperTemplate, Stroke } from '../model/types';
import { compactStroke } from '../sync/compact';

// Pages are stored in two parts: the page record (template, tombstones, background...) in
// `pages`, and each stroke as its own row in `strokes`. These helpers convert between that
// layout and complete `Page` objects, which is what the rest of the app (sync, export) uses.

// Same order as the sync merge (merge.ts), so a page looks identical before and after syncing.
const byCreation = (a: Stroke, b: Stroke) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

function toStroke(row: StoredStroke): Stroke {
  const { pageId: _page, ...stroke } = row;
  return stroke;
}

/** The page record without its ink. */
export function toRecord(page: Page): PageRecord {
  const { strokes: _ink, ...record } = page;
  return record;
}

/** A complete page (record + its strokes, oldest first), or undefined if it isn't on this device. */
export async function loadPage(db: NoteboardDB, pageId: ID): Promise<Page | undefined> {
  return db.transaction('r', db.pages, db.strokes, async () => {
    const record = await db.pages.get(pageId);
    if (!record) return undefined;
    const rows = await db.strokes.where('pageId').equals(pageId).toArray();
    return { ...record, strokes: rows.map(toStroke).sort(byCreation) };
  });
}

/** Complete pages in the order of `pageIds`; missing ones are undefined. */
export async function loadPages(db: NoteboardDB, pageIds: ID[]): Promise<(Page | undefined)[]> {
  return db.transaction('r', db.pages, db.strokes, async () => {
    const records = await db.pages.bulkGet(pageIds);
    const present = records.filter((r): r is PageRecord => !!r).map((r) => r.id);
    const rows = present.length ? await db.strokes.where('pageId').anyOf(present).toArray() : [];
    const byPage = new Map<ID, Stroke[]>();
    for (const row of rows) {
      const list = byPage.get(row.pageId) ?? [];
      list.push(toStroke(row));
      byPage.set(row.pageId, list);
    }
    return records.map((r) => (r ? { ...r, strokes: (byPage.get(r.id) ?? []).sort(byCreation) } : undefined));
  });
}

/** All complete pages matching a set of page records (e.g. every dirty page). */
export async function withStrokes(db: NoteboardDB, records: PageRecord[]): Promise<Page[]> {
  const pages = await loadPages(db, records.map((r) => r.id));
  return pages.filter((p): p is Page => !!p);
}

/**
 * Saves a complete page: its record, plus only the stroke rows that changed (strokes are
 * immutable, so same id = same stroke). Must run inside a transaction that includes
 * `db.pages` and `db.strokes` if it's part of a larger change.
 */
export async function writePage(db: NoteboardDB, page: Page): Promise<void> {
  await db.transaction('rw', db.pages, db.strokes, async () => {
    const existing = new Set((await db.strokes.where('pageId').equals(page.id).primaryKeys()) as ID[]);
    const keep = new Set(page.strokes.map((s) => s.id));
    const gone = [...existing].filter((id) => !keep.has(id));
    const added = page.strokes.filter((s) => !existing.has(s.id));
    if (gone.length) await db.strokes.bulkDelete(gone);
    if (added.length) await db.strokes.bulkPut(added.map((s) => ({ ...s, pageId: page.id })));
    await db.pages.put(toRecord(page));
  });
}

/** Adds a brand-new page (record + any strokes it already has). */
export async function insertPages(db: NoteboardDB, pages: Page[]): Promise<void> {
  await db.transaction('rw', db.pages, db.strokes, async () => {
    await db.pages.bulkAdd(pages.map(toRecord));
    const rows = pages.flatMap((p) => p.strokes.map((s) => ({ ...s, pageId: p.id })));
    if (rows.length) await db.strokes.bulkPut(rows);
  });
}

/** Removes pages and their ink from this device. */
export async function removePages(db: NoteboardDB, pageIds: ID[]): Promise<void> {
  if (!pageIds.length) return;
  await db.transaction('rw', db.pages, db.strokes, async () => {
    await db.strokes.where('pageId').anyOf(pageIds).delete();
    await db.pages.bulkDelete(pageIds);
  });
}

/** An edit made on this device, announced before it is saved (see `onLocalEdit`). */
export interface LocalEdit {
  db: NoteboardDB;
  pageId: ID;
  added: Stroke[];
  removedIds: ID[];
  updatedAt: number;
  /** True if saving failed: the page should be re-read from the database. */
  failed?: boolean;
}

const editListeners = new Set<(edit: LocalEdit) => void>();

/**
 * Tells open pages about edits made on this device, so they can update what they show
 * in memory instead of re-reading every stroke of the page after each line (which froze
 * the app for tens of milliseconds on full pages).
 */
export function onLocalEdit(listener: (edit: LocalEdit) => void): () => void {
  editListeners.add(listener);
  return () => void editListeners.delete(listener);
}

/** Returns the page with an edit applied (same stroke order as loadPage). */
export function applyEdit(page: Page, edit: Pick<LocalEdit, 'added' | 'removedIds' | 'updatedAt'>): Page {
  const removed = new Set(edit.removedIds);
  const addedIds = new Set(edit.added.map((s) => s.id));
  const strokes = page.strokes.filter((s) => !removed.has(s.id) && !addedIds.has(s.id));
  for (const s of edit.added) {
    // Usually the newest stroke, so this is a plain append.
    let i = strokes.length;
    while (i > 0 && byCreation(strokes[i - 1]!, s) > 0) i--;
    strokes.splice(i, 0, s);
  }
  const deletedStrokeIds = edit.removedIds.length
    ? [...new Set([...page.deletedStrokeIds, ...edit.removedIds])]
    : page.deletedStrokeIds;
  return { ...page, strokes, deletedStrokeIds, updatedAt: edit.updatedAt, dirty: 1 };
}

/**
 * Applies an edit to a page: adds strokes and erases strokes by id (recording tombstones).
 * Only the changed strokes are written, so this costs the same on an empty page and a full one.
 */
export async function applyStrokeChange(
  db: NoteboardDB,
  pageId: ID,
  added: Stroke[],
  removedIds: ID[],
): Promise<void> {
  // Stored compactly (0.01 page units): new, moved, scaled and rotated ink alike.
  const compacted = added.map(compactStroke);
  const updatedAt = Date.now();
  const edit: LocalEdit = { db, pageId, added: compacted, removedIds, updatedAt };
  for (const listener of editListeners) listener(edit);
  try {
    await db.transaction('rw', db.pages, db.strokes, async () => {
      const page = await db.pages.get(pageId);
      if (!page) return;
      if (removedIds.length) await db.strokes.bulkDelete(removedIds);
      if (compacted.length) await db.strokes.bulkPut(compacted.map((s) => ({ ...s, pageId })));
      if (removedIds.length) page.deletedStrokeIds = [...new Set([...page.deletedStrokeIds, ...removedIds])];
      page.updatedAt = updatedAt;
      page.dirty = 1;
      await db.pages.put(page);
    });
  } catch (error) {
    for (const listener of editListeners) listener({ ...edit, failed: true });
    throw error;
  }
}

export async function addPage(db: NoteboardDB, notebookId: ID, afterPageId?: ID): Promise<Page | undefined> {
  return db.transaction('rw', db.items, db.pages, db.meta, async () => {
    const notebook = await db.items.get(notebookId);
    if (!notebook || notebook.kind !== 'notebook') return undefined;
    const lastId = afterPageId ?? notebook.pageIds[notebook.pageIds.length - 1];
    const previous = lastId ? await db.pages.get(lastId) : undefined;
    const page = blankPage(notebookId, previous?.template ?? notebook.template);
    const index = afterPageId ? notebook.pageIds.indexOf(afterPageId) + 1 : notebook.pageIds.length;
    notebook.pageIds = [...notebook.pageIds.slice(0, index), page.id, ...notebook.pageIds.slice(index)];
    notebook.updatedAt = Date.now();
    await db.pages.add(toRecord(page));
    await db.items.put(notebook);
    await markLibraryChanged(db);
    return page;
  });
}

export async function deletePage(db: NoteboardDB, notebookId: ID, pageId: ID): Promise<void> {
  await db.transaction('rw', db.items, db.meta, async () => {
    const notebook = await db.items.get(notebookId);
    if (!notebook || notebook.kind !== 'notebook' || notebook.pageIds.length <= 1) return;
    notebook.pageIds = notebook.pageIds.filter((id) => id !== pageId);
    notebook.deletedPageIds = [...new Set([...notebook.deletedPageIds, pageId])];
    notebook.updatedAt = Date.now();
    await db.items.put(notebook);
    await markLibraryChanged(db);
  });
}

export async function setPageTemplate(db: NoteboardDB, pageId: ID, template: PaperTemplate): Promise<void> {
  await db.pages.update(pageId, { template, updatedAt: Date.now(), dirty: 1 });
}

/** Pages of a notebook in display order. Missing pages (not downloaded yet) are skipped. */
export async function notebookPages(db: NoteboardDB, notebookId: ID): Promise<Page[]> {
  const notebook = await db.items.get(notebookId);
  if (!notebook || notebook.kind !== 'notebook') return [];
  const pages = await loadPages(db, notebook.pageIds);
  return pages.filter((p): p is Page => !!p);
}

/**
 * Copies pages (ink, paper and any PDF page underneath) to the end of another notebook, or the
 * same one. Copies get new page and stroke ids: strokes are stored by id, so sharing ids would
 * tie the copy to the original. Returns the new page ids.
 */
export async function copyPagesTo(db: NoteboardDB, pageIds: ID[], targetNotebookId: ID): Promise<ID[]> {
  return db.transaction('rw', [db.items, db.pages, db.strokes, db.meta], async () => {
    const target = await db.items.get(targetNotebookId);
    if (!target || target.kind !== 'notebook' || target.deleted) return [];
    const sources = (await loadPages(db, pageIds)).filter((p): p is Page => !!p);
    const now = Date.now();
    const copies: Page[] = sources.map((src) => ({
      ...src,
      id: crypto.randomUUID(),
      notebookId: targetNotebookId,
      strokes: src.strokes.map((s) => ({ ...s, id: crypto.randomUUID() })),
      deletedStrokeIds: [],
      updatedAt: now,
      dirty: 1,
    }));
    await insertPages(db, copies);
    target.pageIds = [...target.pageIds, ...copies.map((p) => p.id)];
    target.updatedAt = now;
    await db.items.put(target);
    await markLibraryChanged(db);
    return copies.map((p) => p.id);
  });
}

/** Adds blank pages (or pages over a PDF) to the end of a notebook. Returns the new page ids. */
export async function appendPages(
  db: NoteboardDB,
  notebookId: ID,
  specs: { width: number; height: number; background?: Page['background'] }[],
): Promise<ID[]> {
  return db.transaction('rw', [db.items, db.pages, db.strokes, db.meta], async () => {
    const notebook = await db.items.get(notebookId);
    if (!notebook || notebook.kind !== 'notebook' || notebook.deleted) return [];
    const now = Date.now();
    const pages: Page[] = specs.map((spec) => ({
      ...blankPage(notebookId, 'blank', now),
      width: spec.width,
      height: spec.height,
      ...(spec.background ? { background: spec.background } : {}),
    }));
    await insertPages(db, pages);
    notebook.pageIds = [...notebook.pageIds, ...pages.map((p) => p.id)];
    notebook.updatedAt = now;
    await db.items.put(notebook);
    await markLibraryChanged(db);
    return pages.map((p) => p.id);
  });
}
