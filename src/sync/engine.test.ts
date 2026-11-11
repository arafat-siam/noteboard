import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteboardDB } from '../db/db';
import { createNotebook } from '../db/library';
import { applyStrokeChange, loadPage } from '../db/pages';
import { SyncEngine } from './engine';
import { DriveClient } from './drive';
import { setLocalOnly } from './localOnly';

// Pretend Google sign-in is set up for this app (the real ID only exists in the deployed build).
vi.mock('../config', () => ({ GOOGLE_CLIENT_ID: 'test-client-id' }));
import type { Stroke } from '../model/types';

/** A tiny in-memory Google Drive that speaks just enough of the v3 REST API. */
interface FakeFile {
  id: string;
  name: string;
  parents: string[];
  mimeType: string;
  appProperties: Record<string, string>;
  data: Uint8Array;
  modifiedTime: string;
  trashed: boolean;
}

let files: Map<string, FakeFile>;
let clock = 0;
const stamp = () => new Date(1_700_000_000_000 + ++clock * 1000).toISOString();
const meta = (f: FakeFile) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, appProperties: f.appProperties });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

async function parseMultipart(body: Blob, contentType: string) {
  const boundary = contentType.split('boundary=')[1]!;
  const bytes = new Uint8Array(await body.arrayBuffer());
  const text = new TextDecoder('latin1').decode(bytes);
  const parts = text.split(`--${boundary}`).slice(1, -1);
  const metaPart = parts[0]!;
  const metadata = JSON.parse(metaPart.slice(metaPart.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''));
  // Binary-safe slice of the second part's content.
  const secondStart = text.indexOf(`--${boundary}`, text.indexOf(`--${boundary}`) + 1);
  const dataStart = text.indexOf('\r\n\r\n', secondStart) + 4;
  const dataEnd = text.lastIndexOf(`\r\n--${boundary}--`);
  return { metadata, data: bytes.slice(dataStart, dataEnd) };
}

async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  const method = init.method ?? 'GET';
  const path = url.pathname;
  if (path.endsWith('/files') && method === 'GET') {
    const q = url.searchParams.get('q') ?? '';
    let list = [...files.values()].filter((f) => !f.trashed);
    if (q.includes('noteboardRoot')) list = list.filter((f) => f.appProperties.noteboardRoot === '1');
    const parent = q.match(/'([^']+)' in parents/)?.[1];
    if (parent) list = list.filter((f) => f.parents.includes(parent));
    return json({ files: list.map(meta) });
  }
  if (path === '/drive/v3/files' && method === 'POST') {
    const body = JSON.parse(String(init.body));
    const f: FakeFile = { id: crypto.randomUUID(), name: body.name, parents: [], mimeType: body.mimeType, appProperties: body.appProperties ?? {}, data: new Uint8Array(), modifiedTime: stamp(), trashed: false };
    files.set(f.id, f);
    return json({ id: f.id });
  }
  if (path.endsWith('/upload/drive/v3/files') && method === 'POST') {
    const { metadata, data } = await parseMultipart(init.body as Blob, (init.headers as Record<string, string>)['Content-Type']!);
    const f: FakeFile = { id: crypto.randomUUID(), name: metadata.name, parents: metadata.parents, mimeType: metadata.mimeType, appProperties: metadata.appProperties ?? {}, data, modifiedTime: stamp(), trashed: false };
    files.set(f.id, f);
    return json(meta(f));
  }
  const id = path.split('/').pop()!;
  const f = files.get(id);
  if (!f) return new Response('not found', { status: 404 });
  if (path.includes('/upload/') && method === 'PATCH') {
    f.data = new Uint8Array(await (init.body as Blob).arrayBuffer());
    f.modifiedTime = stamp();
    return json(meta(f));
  }
  if (method === 'PATCH') {
    Object.assign(f, JSON.parse(String(init.body)));
    return json({ id });
  }
  if (url.searchParams.get('alt') === 'media') return new Response(f.data, { status: 200 });
  return json(meta(f));
}

const syncDevice = (db: NoteboardDB) =>
  (new SyncEngine(db) as unknown as { run(d: DriveClient): Promise<void> }).run(new DriveClient('test-token'));

const stroke = (id: string): Stroke => ({
  id, tool: 'pen', color: '#000', size: 2.5, hasPressure: true, createdAt: 1,
  points: [10.123456789, 20.987654321, 0.512345, 30.5555555, 40.4444444, 0.6],
});

beforeEach(async () => {
  files = new Map();
  vi.stubGlobal('fetch', fakeFetch);
  (await import('./auth.testing')).setToken();
  vi.stubGlobal('navigator', { onLine: true });
});

describe('sync engine with Google Drive', () => {
  it('syncs shared notebooks compressed, never uploads local-only ones', async () => {
    const a = new NoteboardDB(`a-${crypto.randomUUID()}`);
    const b = new NoteboardDB(`b-${crypto.randomUUID()}`);
    const shared = await createNotebook(a, 'Physics', null);
    const secret = await createNotebook(a, 'Diary', null);
    await applyStrokeChange(a, shared.pageIds[0]!, [stroke('s1')], []);
    await applyStrokeChange(a, secret.pageIds[0]!, [stroke('s2')], []);
    await setLocalOnly(a, secret.id, true);

    await syncDevice(a);
    await syncDevice(b);

    const names = (await b.items.toArray()).map((i) => i.name);
    expect(names).toEqual(['Physics']);
    const page = await loadPage(b, shared.pageIds[0]!);
    expect(page?.strokes.map((s) => s.id)).toEqual(['s1']);
    expect(page?.strokes[0]!.points[0]).toBe(10.12); // stored compactly

    // Nothing about the diary is in Drive, and data files are gzip-compressed.
    const driveFiles = [...files.values()].filter((f) => !f.trashed);
    expect(driveFiles.some((f) => f.appProperties.notebookId === secret.id)).toBe(false);
    for (const f of driveFiles.filter((f) => f.name.endsWith('.json'))) expect([f.data[0], f.data[1]]).toEqual([0x1f, 0x8b]);
  });

  it('removes a notebook from Drive when it is made local-only after syncing', async () => {
    const a = new NoteboardDB(`a-${crypto.randomUUID()}`);
    const nb = await createNotebook(a, 'Journal', null);
    await syncDevice(a);
    expect([...files.values()].some((f) => !f.trashed && f.appProperties.notebookId === nb.id)).toBe(true);

    await setLocalOnly(a, nb.id, true);
    await syncDevice(a);
    expect([...files.values()].some((f) => !f.trashed && f.appProperties.notebookId === nb.id)).toBe(false);
    // Still on this iPad.
    expect((await a.items.get(nb.id))?.deleted).toBe(false);
  });

  it('reads library files written by older versions (plain JSON)', async () => {
    const a = new NoteboardDB(`a-${crypto.randomUUID()}`);
    await syncDevice(a); // creates the root folder + library
    const lib = [...files.values()].find((f) => f.name === 'library.json')!;
    const old = await createNotebook(new NoteboardDB(`x-${crypto.randomUUID()}`), 'From old version', null);
    lib.data = new TextEncoder().encode(JSON.stringify({ format: 1, items: [old] }));
    lib.modifiedTime = stamp();
    const b = new NoteboardDB(`b-${crypto.randomUUID()}`);
    await syncDevice(b);
    expect((await b.items.toArray()).map((i) => i.name)).toContain('From old version');
  });
});

describe('pictures on pages', () => {
  it('syncs a picture to the other device, but never one in a local-only notebook', async () => {
    const a = new NoteboardDB(`a-${crypto.randomUUID()}`);
    const b = new NoteboardDB(`b-${crypto.randomUUID()}`);
    const shared = await createNotebook(a, 'Trip', null);
    const secret = await createNotebook(a, 'Private', null);
    const picture = (id: string, fileId: string): Stroke => ({
      id, tool: 'image', color: '#000000', size: 0, hasPressure: false, createdAt: 2,
      points: [10, 10, 0, 110, 10, 0, 110, 60, 0, 10, 60, 0], image: { fileId },
    });
    const file = (id: string) => ({
      id, name: `${id}.jpg`, mime: 'image/jpeg', size: 3, data: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
      createdAt: 1, uploaded: 0 as const,
    });
    await a.files.bulkPut([file('photo'), file('hidden')]);
    await applyStrokeChange(a, shared.pageIds[0]!, [picture('img1', 'photo')], []);
    await applyStrokeChange(a, secret.pageIds[0]!, [picture('img2', 'hidden')], []);
    await setLocalOnly(a, secret.id, true);

    await syncDevice(a);
    await syncDevice(b);

    const names = [...files.values()].filter((f) => !f.trashed).map((f) => f.name);
    expect(names).toContain('file_photo.jpg');
    expect(names.some((n) => n.includes('hidden'))).toBe(false);
    expect(await b.files.get('photo')).toBeTruthy();
    expect((await loadPage(b, shared.pageIds[0]!))?.strokes[0]).toMatchObject({ tool: 'image', image: { fileId: 'photo' } });
  });
});

describe('two devices writing on the same page', () => {
  it('keeps every stroke from both and honours erasing', async () => {
    const a = new NoteboardDB(`a-${crypto.randomUUID()}`);
    const b = new NoteboardDB(`b-${crypto.randomUUID()}`);
    const nb = await createNotebook(a, 'Shared', null);
    const pageId = nb.pageIds[0]!;
    await applyStrokeChange(a, pageId, [stroke('a1'), stroke('a2')], []);
    await syncDevice(a);
    await syncDevice(b);
    await applyStrokeChange(b, pageId, [stroke('b1')], ['a1']);
    await applyStrokeChange(a, pageId, [stroke('a3')], []);
    await syncDevice(b);
    await syncDevice(a);
    await syncDevice(b);
    for (const db of [a, b]) {
      const page = await loadPage(db, pageId);
      expect(page?.strokes.map((s) => s.id).sort()).toEqual(['a2', 'a3', 'b1']);
      expect(await db.strokes.where('pageId').equals(pageId).count()).toBe(3);
    }
  });
});

describe('pausing sync', () => {
  it('a paused engine never contacts Drive on its own, but "Sync now" still works', async () => {
    const { setToken } = await import('./auth.testing');
    setToken();
    vi.stubGlobal('navigator', { onLine: true });
    const db = new NoteboardDB(`p-${crypto.randomUUID()}`);
    await createNotebook(db, 'Paused notes', null);
    const engine = new SyncEngine(db);
    const calls = vi.fn(fakeFetch);
    vi.stubGlobal('fetch', calls);

    engine.setPaused(true);
    await engine.syncNow();
    expect(calls).not.toHaveBeenCalled();
    expect(engine.current.state).toBe('paused');

    await engine.syncNow(true);
    expect(calls).toHaveBeenCalled();
    expect(engine.current.state).toBe('paused'); // still paused afterwards
    engine.setPaused(false);
  });
});

describe('page loading', () => {
  it('watching one page is not woken up by writes to other pages', async () => {
    const { liveQuery } = await import('dexie');
    const { addPage } = await import('../db/pages');
    const db = new NoteboardDB(`l-${crypto.randomUUID()}`);
    const nb = await createNotebook(db, 'Big', null);
    await addPage(db, nb.id);
    const [first, second] = (await db.items.get(nb.id))!.kind === 'notebook' ? ((await db.items.get(nb.id)) as { pageIds: string[] }).pageIds : [];
    let reads = 0;
    const sub = liveQuery(() => loadPage(db, first!)).subscribe(() => reads++);
    await new Promise((r) => setTimeout(r, 50));
    const before = reads;
    await applyStrokeChange(db, second!, [stroke('other-page')], []);
    await new Promise((r) => setTimeout(r, 50));
    expect(reads).toBe(before);
    await applyStrokeChange(db, first!, [stroke('this-page')], []);
    await new Promise((r) => setTimeout(r, 50));
    expect(reads).toBe(before + 1);
    sub.unsubscribe();
  });
});
