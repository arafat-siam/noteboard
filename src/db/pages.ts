import { scaleStrokeXY } from '../ink/geometry';
import type { NoteboardDB, PageRecord, StoredStroke } from './db';
import { markLibraryChanged, blankPage } from './library';
import { newId, type ID, type Page, type PaperTemplate, type Stroke } from '../model/types';
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
    // A new page continues the paper and size of the page before it.
    const size = previous ? { width: previous.width, height: previous.height } : notebook.pageSize;
    const page = blankPage(notebookId, previous?.template ?? notebook.template, Date.now(), size);
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

/**
 * Changes the size of pages (pages showing an imported PDF keep the PDF's size). Ink keeps its
 * place unless `scaleContent`, which shrinks or grows everything to fit the new page.
 */
export async function setPageSize(
  db: NoteboardDB,
  pageIds: ID[],
  size: { width: number; height: number },
  scaleContent = false,
): Promise<number> {
  let changed = 0;
  for (const id of pageIds) {
    const page = await loadPage(db, id);
    if (!page || page.background) continue;
    if (page.width === size.width && page.height === size.height) continue;
    if (scaleContent && page.strokes.length) {
      const k = Math.min(size.width / page.width, size.height / page.height);
      const scaled = page.strokes.map((s) => ({ ...scaleStrokeXY(s, { x: 0, y: 0 }, k, k, newId()), createdAt: s.createdAt }));
      await applyStrokeChange(db, id, scaled, page.strokes.map((s) => s.id));
    }
    await db.pages.update(id, { width: size.width, height: size.height, updatedAt: Date.now(), dirty: 1 });
    changed++;
  }
  return changed;
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
export async function copyPagesTo(db: NoteboardDB, pageIds: ID[], targetNotebookId: ID, atIndex?: number): Promise<ID[]> {
  return db.transaction('rw', [db.items, db.pages, db.strokes, db.meta], async () => {
    const sources = (await loadPages(db, pageIds)).filter((p): p is Page => !!p);
    return pastePages(db, sources, targetNotebookId, atIndex);
  });
}

/**
 * Inserts copies of these pages (e.g. from the clipboard) into a notebook at `atIndex`
 * (default: the end). Returns the new page ids.
 */
export async function pastePages(db: NoteboardDB, sources: Page[], targetNotebookId: ID, atIndex?: number): Promise<ID[]> {
  return db.transaction('rw', [db.items, db.pages, db.strokes, db.meta], async () => {
    const target = await db.items.get(targetNotebookId);
    if (!target || target.kind !== 'notebook' || target.deleted || !sources.length) return [];
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
    const index = Math.max(0, Math.min(atIndex ?? target.pageIds.length, target.pageIds.length));
    target.pageIds = [...target.pageIds.slice(0, index), ...copies.map((p) => p.id), ...target.pageIds.slice(index)];
    target.updatedAt = now;
    await db.items.put(target);
    await markLibraryChanged(db);
    return copies.map((p) => p.id);
  });
}

/** Moves pages (keeping their order) so they start at `toIndex` of the remaining pages. */
export async function movePages(db: NoteboardDB, notebookId: ID, pageIds: ID[], toIndex: number): Promise<void> {
  await db.transaction('rw', db.items, db.meta, async () => {
    const notebook = await db.items.get(notebookId);
    if (!notebook || notebook.kind !== 'notebook') return;
    const moving = new Set(pageIds);
    const moved = notebook.pageIds.filter((id) => moving.has(id));
    const rest = notebook.pageIds.filter((id) => !moving.has(id));
    const index = Math.max(0, Math.min(toIndex, rest.length));
    const next = [...rest.slice(0, index), ...moved, ...rest.slice(index)];
    if (next.every((id, i) => id === notebook.pageIds[i])) return;
    notebook.pageIds = next;
    notebook.updatedAt = Date.now();
    await db.items.put(notebook);
    await markLibraryChanged(db);
  });
}

/** Deletes several pages (a notebook always keeps at least one). Returns how many were deleted. */
export async function deletePages(db: NoteboardDB, notebookId: ID, pageIds: ID[]): Promise<number> {
  return db.transaction('rw', db.items, db.meta, async () => {
    const notebook = await db.items.get(notebookId);
    if (!notebook || notebook.kind !== 'notebook') return 0;
    const removing = new Set(pageIds.filter((id) => notebook.pageIds.includes(id)));
    if (removing.size >= notebook.pageIds.length) {
      // Keep the first page that isn't being deleted… or the very first page.
      removing.delete(notebook.pageIds[0]!);
    }
    if (!removing.size) return 0;
    notebook.pageIds = notebook.pageIds.filter((id) => !removing.has(id));
    notebook.deletedPageIds = [...new Set([...notebook.deletedPageIds, ...removing])];
    notebook.updatedAt = Date.now();
    await db.items.put(notebook);
    await markLibraryChanged(db);
    return removing.size;
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
