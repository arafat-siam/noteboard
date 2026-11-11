import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { NoteboardDB } from '../db/db';
import { createFolder, createNotebook } from '../db/library';
import { expandLocalOnly, getLocalOnlyRoots, setLocalOnly, takeRemovalQueue } from './localOnly';

describe('keep on this iPad only', () => {
  it('covers everything inside a marked folder', async () => {
    const db = new NoteboardDB(`t-${crypto.randomUUID()}`);
    const school = await createFolder(db, 'School', null);
    const physics = await createFolder(db, 'Physics', school.id);
    const nb = await createNotebook(db, 'Lecture', physics.id);
    const other = await createNotebook(db, 'Shopping', null);
    await setLocalOnly(db, school.id, true);
    const set = expandLocalOnly(await db.items.toArray(), await getLocalOnlyRoots(db));
    expect(set.has(nb.id)).toBe(true);
    expect(set.has(physics.id)).toBe(true);
    expect(set.has(other.id)).toBe(false);
    expect(await takeRemovalQueue(db)).toEqual([school.id]);
  });

  it('turning sync back on re-uploads the pages', async () => {
    const db = new NoteboardDB(`t-${crypto.randomUUID()}`);
    const nb = await createNotebook(db, 'Diary', null);
    await setLocalOnly(db, nb.id, true);
    await db.pages.where('notebookId').equals(nb.id).modify({ dirty: 0 });
    await setLocalOnly(db, nb.id, false);
    expect((await getLocalOnlyRoots(db)).size).toBe(0);
    const pages = await db.pages.where('notebookId').equals(nb.id).toArray();
    expect(pages.every((p) => p.dirty === 1)).toBe(true);
  });
});
