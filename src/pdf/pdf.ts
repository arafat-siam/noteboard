import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { NoteboardDB } from '../db/db';
import { createNotebookFromPages, type PageSpec } from '../db/library';
import { appendPages } from '../db/pages';
import { newId, type ID, type Notebook } from '../model/types';
import type { CanvasRegion } from '../ink/render';

/** PDF points (1/72 in) to page units (CSS px at 96 dpi). */
export const PT_TO_UNITS = 96 / 72;

type PdfJs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJs> | null = null;

/** pdf.js is large, so it's loaded only when a PDF is first needed. */
export function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    const [lib, worker] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  })();
  return pdfjsPromise;
}

const documents = new Map<ID, Promise<PDFDocumentProxy | null>>();

/** Opens a stored PDF (cached). Null if the file isn't on this device yet (still syncing). */
export function getPdf(db: NoteboardDB, fileId: ID): Promise<PDFDocumentProxy | null> {
  let doc = documents.get(fileId);
  if (!doc) {
    doc = (async () => {
      const file = await db.files.get(fileId);
      if (!file) return null;
      const lib = await loadPdfJs();
      return lib.getDocument({ data: new Uint8Array(await file.data.arrayBuffer()) }).promise;
    })();
    documents.set(fileId, doc);
    // Don't cache "not downloaded yet": try again next time.
    void doc.then((d) => d ?? documents.delete(fileId)).catch(() => documents.delete(fileId));
  }
  return doc;
}

/** Reads a PDF, stores it (for sync) and returns one page spec per PDF page, sized like the original. */
async function storePdf(db: NoteboardDB, file: File): Promise<PageSpec[]> {
  const lib = await loadPdfJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  // pdf.js takes ownership of the buffer it's given, so hand it a copy.
  const doc = await lib.getDocument({ data: bytes.slice() }).promise;
  try {
    const fileId = newId();
    const specs: PageSpec[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const viewport = page.getViewport({ scale: 1 });
      specs.push({
        width: Math.round(viewport.width * PT_TO_UNITS),
        height: Math.round(viewport.height * PT_TO_UNITS),
        background: { kind: 'pdf' as const, fileId, pageIndex: i },
      });
    }
    await db.files.put({
      id: fileId,
      name: file.name,
      mime: 'application/pdf',
      size: file.size,
      data: new Blob([bytes], { type: 'application/pdf' }),
      createdAt: Date.now(),
      uploaded: 0,
    });
    return specs;
  } finally {
    void doc.destroy();
  }
}

/** Imports a PDF as a new notebook: one page per PDF page, sized like the original. */
export async function importPdf(db: NoteboardDB, file: File, parentId: ID | null): Promise<Notebook> {
  const specs = await storePdf(db, file);
  const name = file.name.replace(/\.pdf$/i, '') || 'Imported PDF';
  return createNotebookFromPages(db, name, parentId, specs);
}

/** Adds every page of another PDF to the end of an existing notebook. Returns the page count. */
export async function appendPdf(db: NoteboardDB, notebookId: ID, file: File): Promise<number> {
  const specs = await storePdf(db, file);
  return (await appendPages(db, notebookId, specs)).length;
}

/**
 * Renders the part of a PDF page that `region` covers into a fresh canvas at the region's
 * resolution (so PDFs stay sharp at any zoom). Cancel with the returned task.
 */
export async function renderPdfRegion(
  doc: PDFDocumentProxy,
  pageIndex: number,
  region: CanvasRegion,
  pixelWidth: number,
  pixelHeight: number,
): Promise<{ canvas: HTMLCanvasElement; task: RenderTask }> {
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: region.k * PT_TO_UNITS });
  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, pixelWidth, pixelHeight);
  const task = page.render({
    canvasContext: ctx,
    viewport,
    transform: [1, 0, 0, 1, -region.x * region.k, -region.y * region.k],
  });
  return { canvas, task };
}
