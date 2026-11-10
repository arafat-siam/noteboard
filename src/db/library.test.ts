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
import { addPage, applyStrokeChange, notebookPages } from './pages';
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
    const updated = await db.pages.get(page!.id);
    expect(updated?.strokes.map((s) => s.id)).toEqual(['s2']);
    expect(updated?.deletedStrokeIds).toEqual(['s1']);
    expect(updated?.dirty).toBe(1);
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
