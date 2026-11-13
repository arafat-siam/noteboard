import type { PDFPage, RGB } from 'pdf-lib';
import { db as defaultDb, type NoteboardDB } from '../db/db';
import { loadPage, withStrokes, writePage } from '../db/pages';
import { getPdf, renderPdfRegion } from '../pdf/pdf';
import type { LibraryItem, Notebook, Page, PaperTemplate, Stroke } from '../model/types';
import { brushOf, DEFAULT_FILL_OPACITY, drawPage, fillSvgPath, strokeSvgPath } from '../ink/render';
import { arrowPath } from '../ink/shapeTool';
import { drawTextStroke } from '../ink/text';
import { DARK_PAPER, TEMPLATE_METRICS } from '../ink/templates';
import { darkVariant, setInkDark } from '../ink/inkTheme';
import { pdfLinks } from '../ink/links';
import { strokeBounds } from '../ink/geometry';
import { imageCorners, preloadImages } from '../ink/images';
import { mergeLibrary, mergePage } from '../sync/merge';
import { markLibraryChanged } from '../db/library';

/** Page units (CSS px at 96 dpi) to PDF points (72 dpi). */
const PT = 72 / 96;

let rgb: (r: number, g: number, b: number) => RGB;

function hexToRgb(hex: string) {
  const v = Number.parseInt(hex.replace('#', '').slice(0, 6), 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

function drawTemplatePdf(pdfPage: PDFPage, template: PaperTemplate, width: number, height: number, dark = false) {
  const m = TEMPLATE_METRICS;
  if (dark) pdfPage.drawRectangle({ x: 0, y: 0, width: width * PT, height: height * PT, color: hexToRgb(DARK_PAPER.paper) });
  const color = hexToRgb(dark ? DARK_PAPER.line : m.lineColor);
  const h = height * PT;
  const line = (x1: number, y1: number, x2: number, y2: number, c = color) =>
    pdfPage.drawLine({ start: { x: x1 * PT, y: h - y1 * PT }, end: { x: x2 * PT, y: h - y2 * PT }, thickness: 0.6, color: c });

  if (template === 'ruled') {
    for (let y = m.ruledSpacing; y < height; y += m.ruledSpacing) line(0, y, width, y);
    line(m.ruledMargin, 0, m.ruledMargin, height, hexToRgb(dark ? DARK_PAPER.margin : m.marginColor));
  } else if (template === 'grid') {
    for (let y = m.gridSpacing; y < height; y += m.gridSpacing) line(0, y, width, y);
    for (let x = m.gridSpacing; x < width; x += m.gridSpacing) line(x, 0, x, height);
  } else if (template === 'dotted') {
    const dot = hexToRgb(dark ? DARK_PAPER.dot : '#8fa9c2');
    for (let y = m.dotSpacing / 2; y < height; y += m.dotSpacing) {
      for (let x = m.dotSpacing / 2; x < width; x += m.dotSpacing) {
        pdfPage.drawCircle({ x: x * PT, y: h - y * PT, size: 0.9, color: dot });
      }
    }
  }
}

/** Vector PDF: ink stays sharp at any zoom and prints cleanly. */
/**
 * Vector PDF. `dark`: night-mode pages (dark paper, light ink), as shown on screen in night mode.
 */
export async function exportNotebookPdf(
  notebook: Notebook,
  pages: Page[],
  db: NoteboardDB = defaultDb,
  options: { dark?: boolean } = {},
): Promise<Blob> {
  const dark = !!options.dark;
  const ink = (c: string) => hexToRgb(dark ? darkVariant(c) : c);
  // pdf-lib is large; load it only when the user exports.
  const lib = await import('pdf-lib');
  rgb = lib.rgb;
  const pdf = await lib.PDFDocument.create();
  pdf.setTitle(notebook.name);
  pdf.setCreator('Noteboard');
  // Imported PDFs are embedded as real PDF pages (text stays selectable and vector-sharp).
  const sources = new Map<string, Promise<import('pdf-lib').PDFDocument | null>>();
  // Pictures placed on pages, embedded once each (JPEG as-is; anything else as PNG).
  const pictures = new Map<string, Promise<import('pdf-lib').PDFImage | null>>();
  const pictureOf = (fileId: string) => {
    let img = pictures.get(fileId);
    if (!img) {
      img = db.files.get(fileId).then(async (f) => {
        if (!f) return null;
        if (f.mime === 'image/jpeg') return pdf.embedJpg(await f.data.arrayBuffer());
        if (f.mime === 'image/png') return pdf.embedPng(await f.data.arrayBuffer());
        const bitmap = await createImageBitmap(f.data);
        const c = document.createElement('canvas');
        c.width = bitmap.width;
        c.height = bitmap.height;
        c.getContext('2d')!.drawImage(bitmap, 0, 0);
        const png = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
        return png ? pdf.embedPng(await png.arrayBuffer()) : null;
      }).catch(() => null);
      pictures.set(fileId, img);
    }
    return img;
  };
  const sourceOf = (fileId: string) => {
    let src = sources.get(fileId);
    if (!src) {
      src = db.files.get(fileId).then(async (f) => (f ? lib.PDFDocument.load(await f.data.arrayBuffer(), { ignoreEncryption: true }) : null));
      sources.set(fileId, src);
    }
    return src;
  };
  const placed: { page: Page; pdfPage: PDFPage }[] = [];
  for (const page of pages) {
    const pdfPage = pdf.addPage([page.width * PT, page.height * PT]);
    placed.push({ page, pdfPage });
    if (page.background) {
      const src = await sourceOf(page.background.fileId);
      if (src) {
        const [embedded] = await pdf.embedPdf(src, [page.background.pageIndex]);
        if (embedded) pdfPage.drawPage(embedded, { x: 0, y: 0, width: page.width * PT, height: page.height * PT });
      }
    } else {
      drawTemplatePdf(pdfPage, page.template, page.width, page.height, dark);
    }
    // Stacking order, like on screen (pictures and ink layered as arranged).
    const ordered = [...page.strokes].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    for (const stroke of ordered) {
      if (stroke.tool === 'image' || stroke.tool === 'text') {
        const embedded =
          stroke.tool === 'image'
            ? stroke.image
              ? await pictureOf(stroke.image.fileId)
              : null
            : await textImage(stroke, dark).then(async (png) => (png ? pdf.embedPng(await png.arrayBuffer()) : null));
        if (!embedded) continue;
        const [tl, tr, , bl] = imageCorners(stroke) as [{ x: number; y: number }, { x: number; y: number }, unknown, { x: number; y: number }];
        const width = Math.hypot(tr.x - tl.x, tr.y - tl.y) * PT;
        const height = Math.hypot(bl.x - tl.x, bl.y - tl.y) * PT;
        const angle = Math.atan2(tr.y - tl.y, tr.x - tl.x);
        // pdf-lib places the image by its bottom-left corner and rotates counter-clockwise
        // (PDF y points up, the page's y points down).
        pdfPage.drawImage(embedded, {
          x: bl.x * PT,
          y: (page.height - bl.y) * PT,
          width,
          height,
          rotate: lib.degrees((-angle * 180) / Math.PI),
        });
        continue;
      }
      if (stroke.fill) {
        const area = fillSvgPath(stroke);
        if (area) {
          pdfPage.drawSvgPath(area, {
            x: 0,
            y: page.height * PT,
            scale: PT,
            color: ink(stroke.fill),
            opacity: stroke.fillOpacity ?? DEFAULT_FILL_OPACITY,
            borderWidth: 0,
          });
        }
      }
      const path = strokeSvgPath(stroke);
      if (!path) continue;
      const opacity = stroke.tool === 'highlighter' ? 0.35 : stroke.tool === 'tape' ? 1 : (brushOf(stroke)?.opacity ?? 1);
      const strokeColor = stroke.tool === 'pen' ? ink(stroke.color) : hexToRgb(stroke.color);
      pdfPage.drawSvgPath(path, { x: 0, y: page.height * PT, scale: PT, color: strokeColor, opacity, borderWidth: 0 });
      const arrows = arrowPath(stroke);
      if (arrows) pdfPage.drawSvgPath(arrows, { x: 0, y: page.height * PT, scale: PT, color: strokeColor, opacity, borderWidth: 0 });
    }
  }
  await addLinkAnnotations(lib, pdf, placed, db);
  const bytes = await pdf.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

/**
 * Clickable links in the exported PDF: links on items (web addresses, pages that are part of
 * the export) and the links that were in the imported PDF pages.
 */
async function addLinkAnnotations(
  lib: typeof import('pdf-lib'),
  pdf: import('pdf-lib').PDFDocument,
  placed: { page: Page; pdfPage: PDFPage }[],
  db: NoteboardDB,
): Promise<void> {
  const byPageId = new Map(placed.map((p) => [p.page.id, p.pdfPage]));
  const byPdfPage = new Map(placed.filter((p) => p.page.background).map((p) => [`${p.page.background!.fileId}|${p.page.background!.pageIndex}`, p.pdfPage]));
  const add = (pdfPage: PDFPage, page: Page, r: { x: number; y: number; width: number; height: number }, target: { url?: string; to?: PDFPage }) => {
    const rect = [r.x * PT, (page.height - r.y - r.height) * PT, (r.x + r.width) * PT, (page.height - r.y) * PT];
    const annot = pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: rect,
      Border: [0, 0, 0],
      ...(target.url
        ? { A: { Type: 'Action', S: 'URI', URI: lib.PDFString.of(target.url) } }
        : { Dest: [target.to!.ref, lib.PDFName.of('Fit')] }),
    });
    pdfPage.node.addAnnot(pdf.context.register(annot));
  };
  for (const { page, pdfPage } of placed) {
    for (const s of page.strokes) {
      if (!s.link) continue;
      const b = strokeBounds(s);
      if (s.link.kind === 'url') add(pdfPage, page, b, { url: s.link.url });
      else if (s.link.kind === 'page' && byPageId.has(s.link.pageId)) add(pdfPage, page, b, { to: byPageId.get(s.link.pageId)! });
    }
    if (page.background) {
      const doc = await getPdf(db, page.background.fileId);
      if (!doc) continue;
      for (const area of await pdfLinks(doc, page.background.fileId, page.background.pageIndex, page.width, page.height)) {
        if (area.url) add(pdfPage, page, area, { url: area.url });
        else if (area.pageIndex !== undefined) {
          const to = byPdfPage.get(`${page.background.fileId}|${area.pageIndex}`);
          if (to) add(pdfPage, page, area, { to });
        }
      }
    }
  }
}

/** A text box drawn at 4 pixels per page unit (placed on its corners like a picture). */
async function textImage(stroke: Stroke, dark = false): Promise<Blob | null> {
  const t = stroke.text;
  if (!t) return null;
  const k = 4;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(t.width * k));
  canvas.height = Math.max(1, Math.ceil(t.height * k));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(k, k);
  const previous = setInkDark(dark);
  drawTextStroke(ctx, { ...stroke, points: [0, 0, 0, t.width, 0, 0, t.width, t.height, 0, 0, t.height, 0] });
  setInkDark(previous);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** High-resolution PNG of one page, including the paper template. */
export async function exportPagePng(page: Page, pixelScale = 2, db: NoteboardDB = defaultDb, dark = false): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(page.width * pixelScale);
  canvas.height = Math.round(page.height * pixelScale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = dark ? DARK_PAPER.paper : '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (page.background) {
    const doc = await getPdf(db, page.background.fileId);
    if (doc) {
      const region = { x: 0, y: 0, width: page.width, height: page.height, k: pixelScale };
      const { canvas: rendered, task } = await renderPdfRegion(doc, page.background.pageIndex, region, canvas.width, canvas.height);
      await task.promise;
      ctx.drawImage(rendered, 0, 0);
    }
  }
  const m = TEMPLATE_METRICS;
  ctx.strokeStyle = dark ? DARK_PAPER.line : m.lineColor;
  ctx.lineWidth = pixelScale * 0.8;
  ctx.beginPath();
  if (page.template === 'ruled') {
    for (let y = m.ruledSpacing; y < page.height; y += m.ruledSpacing) {
      ctx.moveTo(0, y * pixelScale);
      ctx.lineTo(canvas.width, y * pixelScale);
    }
  } else if (page.template === 'grid') {
    for (let y = m.gridSpacing; y < page.height; y += m.gridSpacing) {
      ctx.moveTo(0, y * pixelScale);
      ctx.lineTo(canvas.width, y * pixelScale);
    }
    for (let x = m.gridSpacing; x < page.width; x += m.gridSpacing) {
      ctx.moveTo(x * pixelScale, 0);
      ctx.lineTo(x * pixelScale, canvas.height);
    }
  }
  ctx.stroke();
  await preloadImages(page.strokes, db);
  const ink = document.createElement('canvas');
  ink.width = canvas.width;
  ink.height = canvas.height;
  // Exports draw in the requested colours, whatever the screen is showing.
  const previous = setInkDark(dark);
  drawPage(ink.getContext('2d')!, page.strokes, { x: 0, y: 0, width: page.width, height: page.height, k: pixelScale });
  setInkDark(previous);
  ctx.drawImage(ink, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create image.'))), 'image/png'),
  );
}

interface Backup {
  app: 'noteboard';
  format: 1;
  exportedAt: string;
  items: LibraryItem[];
  pages: Page[];
}

export async function exportBackup(db: NoteboardDB): Promise<Blob> {
  const backup: Backup = {
    app: 'noteboard',
    format: 1,
    exportedAt: new Date().toISOString(),
    items: await db.items.toArray(),
    pages: await withStrokes(db, await db.pages.toArray()),
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

/** Merges a backup into the library (never overwrites newer local work or loses ink). */
export async function importBackup(db: NoteboardDB, file: Blob): Promise<number> {
  const backup = JSON.parse(await file.text()) as Backup;
  if (backup.app !== 'noteboard' || !Array.isArray(backup.items)) throw new Error('This is not a Noteboard backup.');
  await db.transaction('rw', db.items, db.pages, db.strokes, db.meta, async () => {
    const { merged } = mergeLibrary(await db.items.toArray(), backup.items);
    await db.items.bulkPut(merged);
    for (const page of backup.pages) {
      const local = await loadPage(db, page.id);
      await writePage(db, { ...(local ? mergePage(local, page) : page), dirty: 1 });
    }
    await markLibraryChanged(db);
  });
  return backup.items.filter((i) => !i.deleted).length;
}

/** Share sheet on iPad (Save to Files, AirDrop, Mail…), download elsewhere. */
export async function shareOrDownload(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Several files at once (e.g. one PNG per page): one share sheet, or one download each. */
export async function shareOrDownloadAll(files: { blob: Blob; name: string }[]): Promise<void> {
  if (files.length === 1) return shareOrDownload(files[0]!.blob, files[0]!.name);
  const list = files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
  if (navigator.canShare?.({ files: list })) {
    try {
      await navigator.share({ files: list });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  for (const f of files) {
    await shareOrDownload(f.blob, f.name);
    await new Promise((r) => setTimeout(r, 250));
  }
}

export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Notebook';
}
