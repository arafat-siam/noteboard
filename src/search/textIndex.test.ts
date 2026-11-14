import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { NoteboardDB } from '../db/db';
import { createNotebook } from '../db/library';
import { applyStrokeChange, loadPage } from '../db/pages';
import type { Notebook, Stroke } from '../model/types';
import { indexPage, inkKeyOf, matchRow, pagesToIndex, searchText, typedTextOf } from './textIndex';

const pen = (id: string): Stroke => ({ id, tool: 'pen', color: '#000', size: 2, hasPressure: true, createdAt: 1, points: [0, 0, 0.5, 10, 10, 0.5] });
const textBox = (id: string, content: string): Stroke => ({
  id, tool: 'text', color: '#000', size: 0, hasPressure: false, createdAt: 2,
  points: [0, 0, 0, 100, 0, 0, 100, 20, 0, 0, 20, 0],
  text: { content, font: 'sans', size: 16, width: 100, height: 20 },
});

describe('search text', () => {
  it('fingerprints handwriting only, and changes when ink is added or erased', () => {
    const a = inkKeyOf([pen('1'), pen('2'), textBox('t', 'hi')]);
    expect(inkKeyOf([pen('2'), pen('1')])).toBe(a);
    expect(inkKeyOf([pen('1')])).not.toBe(a);
    expect(typedTextOf([pen('1'), textBox('t', ' Invoice 42 ')])).toBe('Invoice 42');
  });

  it('matches ignoring case and accents, with a snippet around the words', () => {
    const row = { pageId: 'p', notebookId: 'n', ink: 'Meeting notes: café budget for March', inkKey: 'k', typed: '', pdf: '', pdfKey: null, at: 1 };
    const m = matchRow(row, 'CAFE budget');
    expect(m?.source).toBe('ink');
    expect(m?.snippet.match).toBe('café budget');
    expect(m?.snippet.before).toBe('Meeting notes: ');
    expect(matchRow(row, 'x')).toBeNull();
  });

  it('indexes typed text at once, keeps handwriting pending while offline, and reads it when allowed', async () => {
    const db = new NoteboardDB(`t-${crypto.randomUUID()}`);
    const nb = (await createNotebook(db, 'Work', null)) as Notebook;
    const pageId = nb.pageIds[0]!;
    await applyStrokeChange(db, pageId, [pen('a'), pen('b'), pen('c'), textBox('t', 'Quarterly plan')], []);
    const page = (await loadPage(db, pageId))!;

    // Offline: typed text is searchable, handwriting waits.
    await indexPage(page, nb, true, { readInk: null, pdfText: null }, db);
    expect((await searchText('quarterly', undefined, db)).map((m) => m.source)).toEqual(['typed']);
    expect((await pagesToIndex(db)).map((p) => p.pageId)).toEqual([pageId]);

    // A locked or iPad-only notebook is never sent: nothing pending.
    await indexPage(page, nb, false, { readInk: null, pdfText: null }, db);
    expect(await pagesToIndex(db)).toEqual([]);
  });
});
