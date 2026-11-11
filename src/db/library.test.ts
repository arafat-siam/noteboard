import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { NoteboardDB } from './db';
import {
  createFolder,
  createNotebook,
  isVisible,
  moveItems,
  purgeExpiredTrash,
  purgeItems,
  restoreItem,
  sortItems,
  trashItems,
} from './library';
import { addPage, applyEdit, applyStrokeChange, loadPage, notebookPages, onLocalEdit } from './pages';
import type { Stroke } from '../model/types';

let db: NoteboardDB;
beforeEach(() => {
  db = new NoteboardDB(`test-${crypto.randomUUID()}`);
});

const byId = async () => new Map((await db.items.toArray()).map((i) => [i.id, i]));

const stroke = (id: string): Stroke => ({
  id, tool: 'pen', color: '#000', size: 3, points: [0, 0, 0.5, 10, 10, 0.5], hasPressure: true, createdAt: 1,
});

describe('library', () => {
  it('creates a notebook with one page', async () => {
    const nb = await createNotebook(db, '  Physics  ', null);
    expect(nb.name).toBe('Physics');
    expect(await notebookPages(db, nb.id)).toHaveLength(1);
  });

  it('rejects moving a folder into its own subfolder', async () => {
    const a = await createFolder(db, 'A', null);
    const b = await createFolder(db, 'B', a.id);
    await expect(moveItems(db, [a.id], b.id)).rejects.toThrow(/into itself/);
    await expect(moveItems(db, [a.id], a.id)).rejects.toThrow(/into itself/);
  });

  it('moves notebooks between folders', async () => {
    const a = await createFolder(db, 'A', null);
    const nb = await createNotebook(db, 'N', null);
    await moveItems(db, [nb.id], a.id);
    expect((await db.items.get(nb.id))?.parentId).toBe(a.id);
  });

  it('hides contents of a trashed folder and restores to root if the parent is gone', async () => {
    const a = await createFolder(db, 'A', null);
    const nb = await createNotebook(db, 'N', a.id);
    await trashItems(db, [a.id]);
    expect(isVisible(await byId(), nb.id)).toBe(false);

    await trashItems(db, [nb.id]);
    await purgeItems(db, [a.id]);
    // nb was inside A, so purging A deletes it too.
    expect((await db.items.get(nb.id))?.deleted).toBe(true);
  });

  it('restores an item whose folder was trashed to the root', async () => {
    const a = await createFolder(db, 'A', null);
    const nb = await createNotebook(db, 'N', a.id);
    await trashItems(db, [nb.id]);
    await trashItems(db, [a.id]);
    await restoreItem(db, nb.id);
    const restored = await db.items.get(nb.id);
    expect(restored?.parentId).toBeNull();
    expect(isVisible(await byId(), nb.id)).toBe(true);
  });

  it('purges trash older than 30 days only', async () => {
    const old = await createNotebook(db, 'Old', null);
    const recent = await createNotebook(db, 'Recent', null);
    await trashItems(db, [old.id, recent.id]);
    await db.items.update(old.id, { trashedAt: Date.now() - 31 * 86_400_000 });
    expect(await purgeExpiredTrash(db)).toBe(1);
    expect((await db.items.get(old.id))?.deleted).toBe(true);
    expect((await db.items.get(recent.id))?.deleted).toBe(false);
    expect(await db.pages.where('notebookId').equals(old.id).count()).toBe(0);
  });

  it('purging a notebook also removes its ink', async () => {
    const nb = await createNotebook(db, 'Gone', null);
    await applyStrokeChange(db, nb.pageIds[0]!, [stroke('x1'), stroke('x2')], []);
    expect(await db.strokes.count()).toBe(2);
    await purgeItems(db, [nb.id]);
    expect(await db.strokes.count()).toBe(0);
  });

  it('sorts folders first, names naturally', async () => {
    await createNotebook(db, 'Note 10', null);
    await createNotebook(db, 'Note 2', null);
    await createFolder(db, 'Zeta', null);
    const names = sortItems(await db.items.toArray(), 'name').map((i) => i.name);
    expect(names).toEqual(['Zeta', 'Note 2', 'Note 10']);
  });

  it('bumps the library revision on every change', async () => {
    await createFolder(db, 'A', null);
    const rev1 = await db.getMeta<number>('libraryRev');
    await createFolder(db, 'B', null);
    expect(await db.getMeta<number>('libraryRev')).toBe((rev1 ?? 0) + 1);
  });
});

describe('pages', () => {
  it('erasing records a tombstone and marks the page dirty', async () => {
    const nb = await createNotebook(db, 'N', null);
    const [page] = await notebookPages(db, nb.id);
    await db.pages.update(page!.id, { dirty: 0 });
    await applyStrokeChange(db, page!.id, [stroke('s1'), stroke('s2')], []);
    await applyStrokeChange(db, page!.id, [], ['s1']);
    const updated = await loadPage(db, page!.id);
    expect(updated?.strokes.map((s) => s.id)).toEqual(['s2']);
    expect(updated?.deletedStrokeIds).toEqual(['s1']);
    expect(updated?.dirty).toBe(1);
  });

  it('saving a stroke writes only that stroke, however full the page is', async () => {
    const nb = await createNotebook(db, 'Full', null);
    const pageId = nb.pageIds[0]!;
    await applyStrokeChange(db, pageId, Array.from({ length: 300 }, (_, i) => stroke(`old${i}`)), []);
    let written = 0;
    const count = (_key: unknown, obj: unknown) => void (written += Array.isArray((obj as { strokes?: unknown }).strokes) ? 1000 : 1);
    db.strokes.hook('creating', count);
    db.pages.hook('creating', count);
    const updating = () => void written++;
    db.pages.hook('updating', updating);
    await applyStrokeChange(db, pageId, [{ ...stroke('new'), createdAt: 2 }], []);
    db.strokes.hook('creating').unsubscribe(count);
    db.pages.hook('creating').unsubscribe(count);
    db.pages.hook('updating').unsubscribe(updating);
    expect(written).toBeLessThanOrEqual(2); // the new stroke + the small page record
    const page = await loadPage(db, pageId);
    expect(page?.strokes).toHaveLength(301);
    expect(page?.strokes.at(-1)?.id).toBe('new');
  });

  it('an open page updated in memory matches the page saved in the database', async () => {
    const nb = await createNotebook(db, 'Memory', null);
    const pageId = nb.pageIds[0]!;
    await applyStrokeChange(db, pageId, [stroke('a'), { ...stroke('b'), createdAt: 3 }], []);
    let shown = (await loadPage(db, pageId))!;
    const stop = onLocalEdit((edit) => { if (edit.pageId === pageId) shown = applyEdit(shown, edit); });
    await applyStrokeChange(db, pageId, [{ ...stroke('c'), createdAt: 2 }, { ...stroke('d'), createdAt: 9 }], ['a']);
    stop();
    const saved = (await loadPage(db, pageId))!;
    expect(shown.strokes).toEqual(saved.strokes);
    expect(shown.strokes.map((s) => s.id)).toEqual(['c', 'b', 'd']);
    expect(shown.deletedStrokeIds).toEqual(saved.deletedStrokeIds);
    expect(shown.updatedAt).toBe(saved.updatedAt);
  });

  it('moves ink from notes saved by the previous version into the new layout', async () => {
    const name = `m-${crypto.randomUUID()}`;
    const Dexie = (await import('dexie')).default;
    const old = new Dexie(name);
    old.version(2).stores({ items: 'id, kind', pages: 'id, notebookId, dirty', meta: 'key', sync: 'key', files: 'id, uploaded' });
    await old.table('pages').bulkPut([
      { id: 'p1', notebookId: 'n', template: 'blank', strokes: [stroke('a'), stroke('b')], deletedStrokeIds: ['z'], updatedAt: 5, dirty: 0 },
      { id: 'p2', notebookId: 'n', template: 'blank', strokes: [], deletedStrokeIds: [], updatedAt: 6, dirty: 1 },
    ]);
    old.close();

    const upgraded = new NoteboardDB(name);
    const p1 = await loadPage(upgraded, 'p1');
    expect(p1?.strokes.map((s) => s.id)).toEqual(['a', 'b']);
    expect(p1?.deletedStrokeIds).toEqual(['z']);
    expect(p1?.dirty).toBe(0); // nothing re-uploaded just because of the move
    expect((await upgraded.pages.get('p1')) as object).not.toHaveProperty('strokes');
    expect((await loadPage(upgraded, 'p2'))?.strokes).toEqual([]);
    upgraded.close();
  });

  it('inserts a page after a given page', async () => {
    const nb = await createNotebook(db, 'N', null);
    const first = (await db.items.get(nb.id))!;
    const added = await addPage(db, nb.id);
    const middle = await addPage(db, nb.id, first.kind === 'notebook' ? first.pageIds[0] : undefined);
    const order = (await notebookPages(db, nb.id)).map((p) => p.id);
    expect(order[1]).toBe(middle?.id);
    expect(order[2]).toBe(added?.id);
  });
});

describe('copying pages and adding PDFs', () => {
  it('copies a page with its ink to another notebook, leaving the original untouched', async () => {
    const { copyPagesTo } = await import('./pages');
    const from = await createNotebook(db, 'From', null);
    const to = await createNotebook(db, 'To', null);
    const pageId = from.pageIds[0]!;
    await applyStrokeChange(db, pageId, [stroke('c1'), { ...stroke('c2'), fill: '#d93025', fillOpacity: 0.4 }], []);
    const [copyId] = await copyPagesTo(db, [pageId], to.id);

    const target = (await db.items.get(to.id)) as { pageIds: string[] };
    expect(target.pageIds).toEqual([to.pageIds[0], copyId]);
    const copy = (await loadPage(db, copyId!))!;
    expect(copy.notebookId).toBe(to.id);
    expect(copy.dirty).toBe(1);
    expect(copy.strokes).toHaveLength(2);
    expect(copy.strokes.map((s) => s.id)).not.toContain('c1'); // own stroke ids
    expect(copy.strokes.find((s) => s.fill)).toMatchObject({ fill: '#d93025', fillOpacity: 0.4 });

    // Erasing on the copy doesn't touch the original.
    await applyStrokeChange(db, copyId!, [], copy.strokes.map((s) => s.id));
    expect((await loadPage(db, pageId))!.strokes.map((s) => s.id)).toEqual(['c1', 'c2']);
  });

  it('adds pages (e.g. another PDF) to the end of a notebook', async () => {
    const { appendPages } = await import('./pages');
    const nb = await createNotebook(db, 'Doc', null);
    const ids = await appendPages(db, nb.id, [
      { width: 600, height: 800, background: { kind: 'pdf', fileId: 'f2', pageIndex: 0 } },
      { width: 600, height: 800, background: { kind: 'pdf', fileId: 'f2', pageIndex: 1 } },
    ]);
    const pages = await notebookPages(db, nb.id);
    expect(pages.map((p) => p.id)).toEqual([nb.pageIds[0], ...ids]);
    expect(pages[2]!.background).toEqual({ kind: 'pdf', fileId: 'f2', pageIndex: 1 });
  });
});
