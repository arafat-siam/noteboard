import type { NoteboardDB } from './db';
import { markLibraryChanged, blankPage } from './library';
import type { ID, Page, PaperTemplate, Stroke } from '../model/types';
import { compactStroke } from '../sync/compact';

/** Applies an edit to a page: adds strokes and erases strokes by id (recording tombstones). */
export async function applyStrokeChange(
  db: NoteboardDB,
  pageId: ID,
  added: Stroke[],
  removedIds: ID[],
): Promise<void> {
  await db.transaction('rw', db.pages, async () => {
    const page = await db.pages.get(pageId);
    if (!page) return;
    const removed = new Set(removedIds);
    const strokes = page.strokes.filter((s) => !removed.has(s.id));
    // Stored compactly (0.01 page units): new, moved, scaled and rotated ink alike.
    strokes.push(...added.map(compactStroke));
    page.strokes = strokes;
    if (removedIds.length) page.deletedStrokeIds = [...new Set([...page.deletedStrokeIds, ...removedIds])];
    page.updatedAt = Date.now();
    page.dirty = 1;
    await db.pages.put(page);
  });
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
    await db.pages.add(page);
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
  const pages = await db.pages.bulkGet(notebook.pageIds);
  return pages.filter((p): p is Page => !!p);
}
