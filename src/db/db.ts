import Dexie, { type Table } from 'dexie';
import type { LibraryItem, Page, Stroke, StoredFile } from '../model/types';

export interface MetaRow {
  key: string;
  value: unknown;
}

/** Remembers which Google Drive file backs a local record and the version last seen. */
export interface SyncRow {
  key: string;
  fileId: string;
  remoteModified: string;
}

/**
 * A page as stored locally: everything except its ink. Each stroke is its own row in the
 * `strokes` table, so saving a stroke writes one small row instead of rewriting the whole
 * page (which froze the app on full pages). Use `loadPage` / `writePage` in pages.ts to work
 * with complete pages.
 */
export type PageRecord = Omit<Page, 'strokes'>;

/** One stroke, stored on its own and linked to its page. */
export type StoredStroke = Stroke & { pageId: string };

/** A PDF text run on a page, in page units (for search highlights and text selection). */
export interface PdfTextRun {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What search knows about one page. Rebuilt when the ink (`inkKey`) or PDF changes. */
export interface PageTextRow {
  pageId: string;
  notebookId: string;
  /** Handwriting as text (Google Drive OCR); '' when there's no ink or it couldn't be read yet. */
  ink: string;
  /** Fingerprint of the handwriting `ink` was read from; null = not read yet. */
  inkKey: string | null;
  /** Typed text boxes. */
  typed: string;
  /** Text of the imported PDF page under the ink. */
  pdf: string;
  pdfRuns?: PdfTextRun[];
  /** Which PDF page `pdf` came from (fileId:index). */
  pdfKey: string | null;
  at: number;
}

/** Local working copy (IndexedDB). Google Drive is the durable copy shared across devices. */
export class NoteboardDB extends Dexie {
  items!: Table<LibraryItem, string>;
  pages!: Table<PageRecord, string>;
  strokes!: Table<StoredStroke, string>;
  meta!: Table<MetaRow, string>;
  sync!: Table<SyncRow, string>;
  files!: Table<StoredFile, string>;
  /** Searchable text of each page (handwriting read by Google Drive, text boxes, PDF text). Local only. */
  pageText!: Table<PageTextRow, string>;

  constructor(name = 'noteboard') {
    super(name);
    this.version(1).stores({
      items: 'id, kind',
      pages: 'id, notebookId, dirty',
      meta: 'key',
      sync: 'key',
    });
    // v2: imported PDFs.
    this.version(2).stores({
      items: 'id, kind',
      pages: 'id, notebookId, dirty',
      meta: 'key',
      sync: 'key',
      files: 'id, uploaded',
    });
    // v3: strokes in their own table. Existing pages are moved over once, page by page.
    this.version(3)
      .stores({
        items: 'id, kind',
        pages: 'id, notebookId, dirty',
        strokes: 'id, pageId',
        meta: 'key',
        sync: 'key',
        files: 'id, uploaded',
      })
      .upgrade(async (tx) => {
        const pages = tx.table('pages');
        const strokes = tx.table('strokes');
        for (const id of (await pages.toCollection().primaryKeys()) as string[]) {
          const page = (await pages.get(id)) as (PageRecord & { strokes?: Stroke[] }) | undefined;
          if (!page || !Array.isArray(page.strokes)) continue;
          await strokes.bulkPut(page.strokes.map((s) => ({ ...s, pageId: id })));
          const { strokes: _ink, ...record } = page;
          await pages.put(record);
        }
      });
    // v4: search index of page text.
    this.version(4).stores({
      items: 'id, kind',
      pages: 'id, notebookId, dirty',
      strokes: 'id, pageId',
      meta: 'key',
      sync: 'key',
      files: 'id, uploaded',
      pageText: 'pageId, notebookId',
    });
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.meta.put({ key, value });
  }
}

export const db = new NoteboardDB();
