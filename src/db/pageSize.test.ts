import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { NoteboardDB } from './db';
import { createNotebook } from './library';
import { addPage, applyStrokeChange, loadPage, setPageSize } from './pages';
import { describeSize, dimsFor, sizeIdOf } from '../model/pageSizes';
import type { Stroke } from '../model/types';

const stroke = (id: string): Stroke => ({
  id, tool: 'pen', color: '#000', size: 2, hasPressure: true, createdAt: 1, points: [100, 100, 0.5, 700, 1000, 0.5],
});

describe('page sizes', () => {
  it('knows the presets in both orientations', () => {
    expect(dimsFor('a4', 'portrait')).toEqual({ width: 794, height: 1123 });
    expect(dimsFor('a4', 'landscape')).toEqual({ width: 1123, height: 794 });
    expect(sizeIdOf({ width: 1587, height: 1123 })).toBe('a3');
    expect(describeSize({ width: 816, height: 1056 })).toBe('Letter portrait');
  });

  it('new notebooks and new pages use the chosen size', async () => {
    const db = new NoteboardDB(`s-${crypto.randomUUID()}`);
    const nb = await createNotebook(db, 'Wide', null, 'grid', '#000', dimsFor('a4', 'landscape'));
    const added = await addPage(db, nb.id);
    expect(await db.pages.get(nb.pageIds[0]!)).toMatchObject({ width: 1123, height: 794 });
    expect(added).toMatchObject({ width: 1123, height: 794 });
  });

  it('changing the size keeps every stroke (in place, or scaled to fit)', async () => {
    const db = new NoteboardDB(`s-${crypto.randomUUID()}`);
    const nb = await createNotebook(db, 'Notes', null);
    const pageId = nb.pageIds[0]!;
    await applyStrokeChange(db, pageId, [stroke('a'), stroke('b')], []);

    await setPageSize(db, [pageId], dimsFor('a3', 'portrait'));
    let page = await loadPage(db, pageId);
    expect(page).toMatchObject({ width: 1123, height: 1587, dirty: 1 });
    expect(page!.strokes.map((s) => s.id).sort()).toEqual(['a', 'b']);

    await setPageSize(db, [pageId], dimsFor('a5', 'portrait'), true);
    page = await loadPage(db, pageId);
    expect(page!.strokes).toHaveLength(2);
    // Scaled down to fit: nothing pokes out of the smaller page.
    for (const s of page!.strokes) {
      expect(Math.max(...s.points.filter((_, i) => i % 3 === 0))).toBeLessThanOrEqual(page!.width);
    }
    // The originals are tombstoned, so other devices drop them when they sync.
    expect(page!.deletedStrokeIds.sort()).toEqual(['a', 'b']);
  });
});
