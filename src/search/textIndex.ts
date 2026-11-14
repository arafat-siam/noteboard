/**
 * Search index: the text on every page (handwriting read by Google Drive's text recognition,
 * typed text boxes, and the text of imported PDF pages), kept in the local `pageText` table.
 *
 * Handwriting is read in the background while online: only the ink is drawn (cropped, as a
 * compressed JPEG), sent to the user's own Drive as a temporary Google Doc, and the document
 * is deleted as soon as its text is read. Notebooks kept on this iPad only and locked
 * notebooks are never sent.
 */
import { db, type NoteboardDB, type PageTextRow } from '../db/db';
import { loadPage } from '../db/pages';
import type { ID, LibraryItem, Notebook, Page, Stroke } from '../model/types';
import { strokeBounds } from '../ink/geometry';

/** Strokes that count as handwriting (not pictures, text boxes, tape or highlighter). */
export function handwriting(strokes: Stroke[]): Stroke[] {
  return strokes.filter((s) => s.tool === 'pen' && !s.locked);
}

/** Fingerprint of a page's handwriting: changes whenever a stroke is added or erased. */
export function inkKeyOf(strokes: Stroke[]): string {
  const ids = handwriting(strokes)
    .map((s) => s.id)
    .sort();
  let h = 5381;
  for (const id of ids) for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return `${ids.length}:${h.toString(36)}`;
}

export function typedTextOf(strokes: Stroke[]): string {
  return strokes
    .filter((s) => s.tool === 'text' && s.text?.content)
    .map((s) => s.text!.content.trim())
    .join('\n');
}

/** Pages with fewer handwriting strokes than this are not worth reading. */
export const MIN_STROKES = 3;

/** Draws only the handwriting, cropped to it, black on white, as a compressed JPEG. */
export async function inkImage(strokes: Stroke[], minStrokes = MIN_STROKES): Promise<Blob | null> {
  const ink = handwriting(strokes);
  if (ink.length < minStrokes) return null;
  const { drawStroke } = await import('../ink/render');
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of ink) {
    const b = strokeBounds(s);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  const margin = 16;
  x0 -= margin;
  y0 -= margin;
  const w = x1 - x0 + margin;
  const h = y1 - y0 + margin;
  // About 1.6 px per page unit reads well; never more than 2200 px on a side.
  const k = Math.min(1.6, 2200 / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
  // Every colour as dark ink: recognition reads contrast, and light colours vanish.
  for (const s of ink) drawStroke(ctx, { ...s, color: '#111111' });
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.72));
}

/** Language hint for text recognition: the iPad's language (for example "en" or "bn"). */
export function recognitionLanguage(): string {
  return (navigator.language || 'en').split('-')[0]!.toLowerCase();
}

// ---- Search ----------------------------------------------------------------------------

export interface TextMatch {
  notebookId: ID;
  pageId: ID;
  /** Where the words were found. */
  source: 'ink' | 'typed' | 'pdf';
  snippet: { before: string; match: string; after: string };
}

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Finds `query` (case and accent insensitive) in a row; returns the best snippet. */
export function matchRow(row: PageTextRow, query: string): TextMatch | null {
  const q = fold(query.trim());
  if (q.length < 2) return null;
  for (const source of ['ink', 'typed', 'pdf'] as const) {
    const text = row[source];
    if (!text) continue;
    const flat = text.replace(/\s+/g, ' ');
    const at = fold(flat).indexOf(q);
    if (at < 0) continue;
    const start = Math.max(0, at - 40);
    const end = Math.min(flat.length, at + q.length + 60);
    return {
      notebookId: row.notebookId,
      pageId: row.pageId,
      source,
      snippet: {
        before: (start > 0 ? '…' : '') + flat.slice(start, at),
        match: flat.slice(at, at + q.length),
        after: flat.slice(at + q.length, end) + (end < flat.length ? '…' : ''),
      },
    };
  }
  return null;
}

/** Every page whose text contains `query`, in notebook page order when `order` is given. */
export async function searchText(query: string, notebookId?: ID, database: NoteboardDB = db): Promise<TextMatch[]> {
  const rows = notebookId ? await database.pageText.where('notebookId').equals(notebookId).toArray() : await database.pageText.toArray();
  const out: TextMatch[] = [];
  for (const row of rows) {
    const m = matchRow(row, query);
    if (m) out.push(m);
  }
  return out;
}

// ---- Indexing ----------------------------------------------------------------------------

export interface IndexOptions {
  /** Reads handwriting (uploads a picture of it); null = offline / not signed in. */
  readInk: ((image: Blob) => Promise<string>) | null;
  /** Text of an imported PDF page (null = PDFs not available here, e.g. in tests). */
  pdfText: ((fileId: ID, pageIndex: number) => Promise<{ text: string; runs: PageTextRow['pdfRuns'] } | null>) | null;
}

/**
 * Brings one page's search text up to date. Returns true if Drive was asked to read handwriting
 * (so the caller can pace itself).
 */
export async function indexPage(page: Page, notebook: Notebook, allowInk: boolean, options: IndexOptions, database: NoteboardDB = db): Promise<boolean> {
  const old = await database.pageText.get(page.id);
  const inkKey = inkKeyOf(page.strokes);
  const pdfKey = page.background ? `${page.background.fileId}:${page.background.pageIndex}` : null;
  const row: PageTextRow = old
    ? { ...old, notebookId: notebook.id }
    : { pageId: page.id, notebookId: notebook.id, ink: '', inkKey: null, typed: '', pdf: '', pdfKey: null, at: 0 };
  row.typed = typedTextOf(page.strokes);
  let readInk = false;

  if (row.pdfKey !== pdfKey) {
    row.pdf = '';
    row.pdfRuns = undefined;
    row.pdfKey = null;
    if (pdfKey && options.pdfText) {
      const got = await options.pdfText(page.background!.fileId, page.background!.pageIndex).catch(() => null);
      if (got) {
        row.pdf = got.text;
        row.pdfRuns = got.runs;
        row.pdfKey = pdfKey;
      }
    } else if (!pdfKey) row.pdfKey = null;
  }

  if (row.inkKey !== inkKey) {
    if (handwriting(page.strokes).length < MIN_STROKES) {
      row.ink = '';
      row.inkKey = inkKey;
    } else if (allowInk && options.readInk) {
      const image = await inkImage(page.strokes);
      if (image) {
        row.ink = await options.readInk(image);
        row.inkKey = inkKey;
        readInk = true;
      }
    }
  }
  // Handwriting still to be read (offline or signed out): stays on the to-do list.
  const inkPending = row.inkKey !== inkKey && allowInk;
  row.at = inkPending ? 0 : Date.now();
  await database.pageText.put(row);
  return readInk;
}

/** Notebooks whose pages may be indexed, and whether their handwriting may be sent to Drive. */
export function indexable(items: LibraryItem[], localOnly: ReadonlySet<ID>): { notebook: Notebook; allowInk: boolean }[] {
  return items
    .filter((i): i is Notebook => i.kind === 'notebook' && !i.deleted)
    .map((notebook) => ({ notebook, allowInk: !localOnly.has(notebook.id) && !notebook.lock }));
}

/** Pages that need work: never indexed, or edited since. */
export async function pagesToIndex(database: NoteboardDB = db): Promise<{ pageId: ID; notebookId: ID }[]> {
  const rows = new Map((await database.pageText.toArray()).map((r) => [r.pageId, r]));
  const out: { pageId: ID; notebookId: ID }[] = [];
  for (const record of await database.pages.toArray()) {
    const row = rows.get(record.id);
    if (!row || record.updatedAt > row.at) out.push({ pageId: record.id, notebookId: record.notebookId });
  }
  return out;
}

/** Drops index rows of pages that no longer exist. */
export async function pruneIndex(database: NoteboardDB = db): Promise<void> {
  const live = new Set((await database.pages.toCollection().primaryKeys()) as string[]);
  const stale = ((await database.pageText.toCollection().primaryKeys()) as string[]).filter((id) => !live.has(id));
  if (stale.length) await database.pageText.bulkDelete(stale);
}

export { loadPage };
