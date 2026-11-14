import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { NoteboardDB } from '../db/db';
import { loadPage } from '../db/pages';
import { createMonthPlanner } from './planner';

describe('monthly planner', () => {
  it('makes a month page whose day numbers link to day pages that link back', async () => {
    const db = new NoteboardDB(`p-${crypto.randomUUID()}`);
    const nb = await createMonthPlanner(db, 2027, 1, null); // February 2027: 28 days
    expect(nb.pageIds).toHaveLength(29);
    const month = (await loadPage(db, nb.pageIds[0]!))!;
    const links = month.strokes.filter((s) => s.link?.kind === 'page').map((s) => (s.link as { pageId: string }).pageId);
    expect(links).toEqual(nb.pageIds.slice(1));
    const day = (await loadPage(db, nb.pageIds[5]!))!;
    expect(day.strokes.some((s) => s.link?.kind === 'page' && s.link.pageId === nb.pageIds[0])).toBe(true);
    // Planner furniture is locked so it can't be moved or erased by accident.
    expect(day.strokes.every((s) => s.locked)).toBe(true);
  });
});
