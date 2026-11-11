import { describe, expect, it } from 'vitest';
import { compactPage, compactPoints, compactStroke, gzipJson, readJson } from './compact';
import type { Page } from '../model/types';

const page = (): Page => ({
  id: 'p',
  notebookId: 'n',
  template: 'ruled',
  width: 794,
  height: 1123,
  strokes: Array.from({ length: 50 }, (_, s) => ({
    id: `s${s}`,
    tool: 'pen' as const,
    color: '#000',
    size: 2.5,
    hasPressure: true,
    createdAt: 1,
    points: Array.from({ length: 300 }, (_, i) => (i % 3 === 2 ? Math.random() : 100 + Math.random() * 600)),
  })),
  deletedStrokeIds: [],
  updatedAt: 1,
  dirty: 0,
});

describe('compact storage', () => {
  it('rounds to 0.01 units and 0.001 pressure', () => {
    expect(compactPoints([12.345678, 98.7654321, 0.4567891])).toEqual([12.35, 98.77, 0.457]);
  });

  it('never moves ink by more than 0.005 page units', () => {
    const p = page();
    const c = compactPage(p);
    p.strokes.forEach((s, i) =>
      s.points.forEach((v, j) => {
        if (j % 3 !== 2) expect(Math.abs(v - c.strokes[i]!.points[j]!)).toBeLessThanOrEqual(0.005 + 1e-9);
      }),
    );
  });

  it('round-trips through gzip and is much smaller', async () => {
    const p = page();
    const raw = JSON.stringify(p).length;
    const blob = await gzipJson(compactPage(p));
    expect(blob.size).toBeLessThan(raw / 4);
    expect(await readJson<Page>(await blob.arrayBuffer())).toEqual(compactPage(p));
  });

  it('still reads old uncompressed files', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ hello: 'world' })).buffer;
    expect(await readJson(bytes)).toEqual({ hello: 'world' });
  });
});

describe('shape fill', () => {
  it('keeps fill colour and opacity through compacting and merging', async () => {
    const { mergePage } = await import('./merge');
    const s = { id: 'f', tool: 'pen' as const, color: '#000', size: 2, hasPressure: true, createdAt: 1, points: [0, 0, 0.5, 10, 0, 0.5, 10, 10, 0.5], fill: '#d93025', fillOpacity: 0.45 };
    const c = compactStroke(s);
    expect([c.fill, c.fillOpacity]).toEqual(['#d93025', 0.45]);
    const page = { id: 'p', notebookId: 'n', template: 'blank' as const, width: 1, height: 1, strokes: [c], deletedStrokeIds: [], updatedAt: 1, dirty: 0 as const };
    const merged = mergePage(page, { ...page, strokes: [] });
    expect(merged.strokes[0]).toMatchObject({ fill: '#d93025', fillOpacity: 0.45 });
  });
});
