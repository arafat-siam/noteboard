/** Runs the search indexer in the background: after each sync, when coming online, and every few minutes. */
import { db } from '../db/db';
import { getToken } from '../sync/auth';
import { DriveAuthError, DriveClient } from '../sync/drive';
import { expandLocalOnly, getLocalOnlyRoots } from '../sync/localOnly';
import { sync } from '../sync/instance';
import { penActiveWithin } from '../ink/penState';
import { indexable, indexPage, loadPage, pagesToIndex, pruneIndex, recognitionLanguage } from './textIndex';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A page edited this recently is probably still being written: read it a little later. */
const SETTLE_MS = 20_000;

let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

/** Called whenever new text lands in the index (search results can refresh). */
export function onIndexChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function indexSoon(delay = 3_000): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void run();
  }, delay);
}

async function pdfText(fileId: string, pageIndex: number) {
  const { getPdf, pdfPageText } = await import('../pdf/pdf');
  const doc = await getPdf(db, fileId);
  return doc ? pdfPageText(doc, pageIndex) : null;
}

async function run(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  let later = false;
  try {
    await pruneIndex();
    const items = await db.items.toArray();
    const localOnly = expandLocalOnly(items, await getLocalOnlyRoots(db));
    const notebooks = new Map(indexable(items, localOnly).map((x) => [x.notebook.id, x]));
    const token = getToken();
    const drive = token && navigator.onLine ? new DriveClient(token) : null;
    const language = recognitionLanguage();
    for (const { pageId, notebookId } of await pagesToIndex()) {
      const entry = notebooks.get(notebookId);
      if (!entry) continue;
      // Never compete with the Pencil.
      while (penActiveWithin(5_000)) await sleep(2_000);
      const record = await db.pages.get(pageId);
      if (!record) continue;
      if (Date.now() - record.updatedAt < SETTLE_MS) {
        later = true;
        continue;
      }
      const page = await loadPage(db, pageId);
      if (!page) continue;
      try {
        const read = await indexPage(page, entry.notebook, entry.allowInk, {
          readInk: drive ? (image) => drive.readTextFromImage(image, language) : null,
          pdfText,
        });
        listeners.forEach((l) => l());
        // Gentle on Drive: one picture every 1.5 s at most.
        if (read) await sleep(1_500);
      } catch (error) {
        if (error instanceof DriveAuthError) break;
        // Anything else (network, a page Drive could not read): try again next time.
      }
    }
  } finally {
    running = false;
    if (again || later) {
      again = false;
      indexSoon(later ? SETTLE_MS : 1_000);
    }
  }
}

/** Starts background indexing; returns a stop function. */
export function startIndexer(): () => void {
  const kick = () => indexSoon();
  const unsubscribe = sync.subscribe((s) => {
    if (s.state === 'idle') kick();
  });
  const interval = setInterval(kick, 5 * 60_000);
  window.addEventListener('online', kick);
  indexSoon(8_000);
  return () => {
    unsubscribe();
    clearInterval(interval);
    window.removeEventListener('online', kick);
  };
}
