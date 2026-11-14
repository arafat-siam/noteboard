import { describe, expect, it } from 'vitest';
import { mergeLibrary, mergePage, samePageContent } from './merge';
import type { Folder, Page, Stroke } from '../model/types';

const stroke = (id: string, createdAt = 1): Stroke => ({
  id, tool: 'pen', color: '#000', size: 3, points: [0, 0, 0.5], hasPressure: true, createdAt,
});

const page = (over: Partial<Page>): Page => ({
  id: 'p', notebookId: 'n', template: 'ruled', width: 794, height: 1123,
  strokes: [], deletedStrokeIds: [], updatedAt: 1, dirty: 0, ...over,
});

const folder = (over: Partial<Folder>): Folder => ({
  kind: 'folder', id: 'f', parentId: null, name: 'F', color: '#000', createdAt: 1, updatedAt: 1,
  trashedAt: null, favorite: false, deleted: false, ...over,
});

describe('mergePage', () => {
  it('keeps ink written on both devices', () => {
    const merged = mergePage(page({ strokes: [stroke('a', 1)] }), page({ strokes: [stroke('b', 2)] }));
    expect(merged.strokes.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('applies erasures from either device', () => {
    const local = page({ strokes: [stroke('a'), stroke('b')] });
    const remote = page({ strokes: [stroke('a')], deletedStrokeIds: ['b'] });
    expect(mergePage(local, remote).strokes.map((s) => s.id)).toEqual(['a']);
    expect(mergePage(remote, local).strokes.map((s) => s.id)).toEqual(['a']);
  });

  it('uses the newest page settings', () => {
    const merged = mergePage(page({ template: 'grid', updatedAt: 5 }), page({ template: 'dotted', updatedAt: 9 }));
    expect(merged.template).toBe('dotted');
    expect(merged.updatedAt).toBe(9);
  });

  it('detects identical content', () => {
    const a = page({ strokes: [stroke('a')] });
    expect(samePageContent(a, mergePage(a, a))).toBe(true);
    expect(samePageContent(a, page({}))).toBe(false);
  });
});

describe('whiteboard pages', () => {
  it('keep the larger size from either device', () => {
    const a = { ...page({ updatedAt: 5 }), grows: true, width: 1600, height: 3200 };
    const b = { ...page({ updatedAt: 9 }), grows: true, width: 2400, height: 1600 };
    const merged = mergePage(a, b);
    expect([merged.width, merged.height]).toEqual([2400, 3200]);
  });
});

describe('mergeLibrary', () => {
  it('takes the newer copy of each item', () => {
    const { merged, localChanged, remoteChanged } = mergeLibrary(
      [folder({ name: 'Old', updatedAt: 1 })],
      [folder({ name: 'New', updatedAt: 2 })],
    );
    expect(merged[0]?.name).toBe('New');
    expect(localChanged).toBe(true);
    expect(remoteChanged).toBe(false);
  });

  it('adds items that exist on only one side', () => {
    const r = mergeLibrary([folder({ id: 'a' })], [folder({ id: 'b' })]);
    expect(r.merged.map((i) => i.id).sort()).toEqual(['a', 'b']);
    expect(r.localChanged && r.remoteChanged).toBe(true);
  });

  it('never resurrects a permanently deleted item', () => {
    const r = mergeLibrary([folder({ deleted: true, updatedAt: 1 })], [folder({ name: 'Renamed', updatedAt: 5 })]);
    expect(r.merged[0]?.deleted).toBe(true);
  });

  it('keeps pages added on both devices and drops pages deleted on either', () => {
    const base = {
      kind: 'notebook' as const, id: 'n', parentId: null, name: 'N', coverColor: '#000', template: 'ruled' as const,
      tags: [], createdAt: 1, trashedAt: null, favorite: false, deleted: false, lastOpenedAt: null,
    };
    const local = { ...base, pageIds: ['p1', 'p2', 'pA'], deletedPageIds: [], updatedAt: 5 };
    const remote = { ...base, pageIds: ['p1', 'pB'], deletedPageIds: ['p2'], updatedAt: 4 };
    const merged = mergeLibrary([local], [remote]).merged[0];
    expect(merged?.kind === 'notebook' && merged.pageIds).toEqual(['p1', 'pA', 'pB']);
  });

  it('keeps bookmarks made on either device and honours removals', () => {
    const base = {
      kind: 'notebook' as const, id: 'n', parentId: null, name: 'N', coverColor: '#000', template: 'ruled' as const,
      tags: [], createdAt: 1, trashedAt: null, favorite: false, deleted: false, lastOpenedAt: null, pageIds: ['p1', 'p2'], deletedPageIds: [],
    };
    const mark = (id: string, title: string, createdAt: number) => ({ id, pageId: 'p1', title, createdAt });
    const local = { ...base, updatedAt: 5, bookmarks: [mark('a', 'Intro', 1), mark('b', 'Local', 2)], deletedBookmarkIds: [] };
    const remote = { ...base, updatedAt: 4, bookmarks: [mark('a', 'Old title', 1), mark('c', 'Remote', 3)], deletedBookmarkIds: ['b'] };
    const merged = mergeLibrary([local], [remote]).merged[0];
    expect(merged?.kind === 'notebook' && merged.bookmarks?.map((b) => b.title)).toEqual(['Intro', 'Remote']);
  });

  it('reports no changes when both sides match', () => {
    const r = mergeLibrary([folder({})], [folder({})]);
    expect(r.localChanged || r.remoteChanged).toBe(false);
  });
});

describe('mergePage with imported PDFs', () => {
  it('keeps the PDF background whichever copy is newer', () => {
    const background = { kind: 'pdf' as const, fileId: 'f1', pageIndex: 3 };
    const withBg = page({ background, strokes: [stroke('a')], updatedAt: 1 });
    const newerWithoutField = { ...page({ strokes: [stroke('b')], updatedAt: 9 }), background };
    expect(mergePage(withBg, newerWithoutField).background).toEqual(background);
    expect(mergePage(newerWithoutField, withBg).background).toEqual(background);
  });
});

describe('new kinds of items survive merging and compacting', () => {
  it('keeps text boxes, tape, dashed lines, arrows and pen styles intact', async () => {
    const { compactStroke } = await import('./compact');
    const text: Stroke = {
      ...stroke('t', 5), tool: 'text', size: 0, hasPressure: false,
      points: [0, 0, 0, 100, 0, 0, 100, 30, 0, 0, 30, 0],
      text: { content: 'Hello', font: 'serif', size: 18, bold: true, width: 100, height: 30, align: 'center' },
    };
    const tape: Stroke = { ...stroke('tp', 6), tool: 'tape', color: '#f4b400', size: 28, points: [0, 0, 0, 50, 0, 0] };
    const line: Stroke = { ...stroke('l', 7), dash: 'dotted', arrowEnd: true, brush: 'calligraphy', penStyle: { opacity: 0.5, thinning: 0.2 } };
    const merged = mergePage(page({ strokes: [text, tape] }), page({ strokes: [line] }));
    expect(merged.strokes.map((s) => s.id)).toEqual(['t', 'tp', 'l']);
    expect(merged.strokes[0]!.text).toEqual(text.text);
    expect(merged.strokes[1]!.tool).toBe('tape');
    const kept = compactStroke(merged.strokes[2]!);
    expect([kept.dash, kept.arrowEnd, kept.brush, kept.penStyle]).toEqual(['dotted', true, 'calligraphy', { opacity: 0.5, thinning: 0.2 }]);
    expect(compactStroke(text).text).toEqual(text.text);
  });
});

describe('notebook settings sync', () => {
  it('the newer page look (night mode, PDF invert) wins and is kept', () => {
    const base = {
      kind: 'notebook' as const, id: 'n', parentId: null, name: 'N', coverColor: '#000', template: 'ruled' as const,
      pageIds: ['p'], deletedPageIds: [], tags: [], lastOpenedAt: null, createdAt: 1, updatedAt: 1,
      trashedAt: null, favorite: false, deleted: false,
    };
    const local = { ...base, updatedAt: 5, pageTheme: 'dark' as const, invertPdf: true };
    const remote = { ...base, updatedAt: 3 };
    expect(mergeLibrary([local], [remote]).merged[0]).toMatchObject({ pageTheme: 'dark', invertPdf: true });
    expect(mergeLibrary([remote], [local]).merged[0]).toMatchObject({ pageTheme: 'dark' });
  });
});

describe('locked and grouped items sync', () => {
  it('keeps lock and group flags, and an unlock (new id) replaces the locked copy', () => {
    const locked: Stroke = { ...stroke('x', 3), locked: true, group: 'g1' };
    const unlocked: Stroke = { ...stroke('y', 3), group: 'g1' };
    const merged = mergePage(page({ strokes: [locked] }), page({ strokes: [unlocked], deletedStrokeIds: ['x'] }));
    expect(merged.strokes.map((s) => [s.id, !!s.locked, s.group])).toEqual([['y', false, 'g1']]);
    expect(mergePage(page({ strokes: [locked] }), page({})).strokes[0]).toMatchObject({ locked: true, group: 'g1' });
  });
});

describe('links sync', () => {
  it('keeps an item link through merging', () => {
    const linked: Stroke = { ...stroke('l', 4), link: { kind: 'url', url: 'https://example.com/' } };
    expect(mergePage(page({ strokes: [linked] }), page({})).strokes[0]!.link).toEqual({ kind: 'url', url: 'https://example.com/' });
  });
});

describe('recordings sync', () => {
  const nb = (over: Record<string, unknown>) => ({
    kind: 'notebook' as const, id: 'n', parentId: null, name: 'N', coverColor: '#000', template: 'ruled' as const,
    pageIds: ['p'], deletedPageIds: [], tags: [], lastOpenedAt: null, createdAt: 1, updatedAt: 1,
    trashedAt: null, favorite: false, deleted: false, ...over,
  });
  const rec = (id: string, createdAt: number, name = id) => ({ id, fileId: `f-${id}`, name, createdAt, durationMs: 1000 });

  it('keeps recordings made on both devices and honours deletions', () => {
    const local = nb({ updatedAt: 5, recordings: [rec('a', 1), rec('b', 2, 'Lecture')] });
    const remote = nb({ updatedAt: 3, recordings: [rec('a', 1), rec('c', 3)], deletedRecordingIds: ['b'] });
    const merged = mergeLibrary([local], [remote]).merged[0] as unknown as { recordings: { id: string }[] };
    expect(merged.recordings.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('does not churn notebooks without recordings', () => {
    const a = nb({ updatedAt: 2 });
    const result = mergeLibrary([a], [{ ...a }]);
    expect([result.localChanged, result.remoteChanged]).toEqual([false, false]);
    expect('recordings' in result.merged[0]!).toBe(false);
  });
});

describe('mergePresets', () => {
  const p = (id: string, updatedAt: number, color = '#000') => ({ id, name: id, updatedAt, slots: [{ id: 'x', kind: 'pen' as const, brush: 'fountain' as const, color, size: 2 }] });
  it('keeps presets from both sides, newer edit wins, deletions stick, latest default wins', async () => {
    const { mergePresets } = await import('../ink/presets');
    const local = { presets: [p('a', 1), p('b', 5, '#111')], deletedIds: [], defaultId: 'a', defaultAt: 2 };
    const remote = { presets: [p('b', 3, '#222'), p('c', 1)], deletedIds: ['a'], defaultId: 'c', defaultAt: 4 };
    const { merged, localChanged, remoteChanged } = mergePresets(local, remote);
    expect(merged.presets.map((x) => x.id)).toEqual(['b', 'c']);
    expect(merged.presets[0]!.slots[0]!.color).toBe('#111');
    expect(merged.defaultId).toBe('c');
    expect(localChanged && remoteChanged).toBe(true);
    expect(mergePresets(merged, merged).localChanged).toBe(false);
  });
});
