import type { PDFPage, RGB } from 'pdf-lib';
import type { NoteboardDB } from '../db/db';
import type { LibraryItem, Notebook, Page, PaperTemplate } from '../model/types';
import { drawPage, outlineToSvgPath, strokeOutline } from '../ink/render';
import { TEMPLATE_METRICS } from '../ink/templates';
import { mergeLibrary, mergePage } from '../sync/merge';
import { markLibraryChanged } from '../db/library';

/** Page units (CSS px at 96 dpi) to PDF points (72 dpi). */
const PT = 72 / 96;

let rgb: (r: number, g: number, b: number) => RGB;

function hexToRgb(hex: string) {
  const v = Number.parseInt(hex.replace('#', '').slice(0, 6), 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

function drawTemplatePdf(pdfPage: PDFPage, template: PaperTemplate, width: number, height: number) {
  const m = TEMPLATE_METRICS;
  const color = hexToRgb(m.lineColor);
  const h = height * PT;
  const line = (x1: number, y1: number, x2: number, y2: number, c = color) =>
    pdfPage.drawLine({ start: { x: x1 * PT, y: h - y1 * PT }, end: { x: x2 * PT, y: h - y2 * PT }, thickness: 0.6, color: c });

  if (template === 'ruled') {
    for (let y = m.ruledSpacing; y < height; y += m.ruledSpacing) line(0, y, width, y);
    line(m.ruledMargin, 0, m.ruledMargin, height, hexToRgb(m.marginColor));
  } else if (template === 'grid') {
    for (let y = m.gridSpacing; y < height; y += m.gridSpacing) line(0, y, width, y);
    for (let x = m.gridSpacing; x < width; x += m.gridSpacing) line(x, 0, x, height);
  } else if (template === 'dotted') {
    const dot = hexToRgb('#8fa9c2');
    for (let y = m.dotSpacing / 2; y < height; y += m.dotSpacing) {
      for (let x = m.dotSpacing / 2; x < width; x += m.dotSpacing) {
        pdfPage.drawCircle({ x: x * PT, y: h - y * PT, size: 0.9, color: dot });
      }
    }
  }
}

/** Vector PDF: ink stays sharp at any zoom and prints cleanly. */
export async function exportNotebookPdf(notebook: Notebook, pages: Page[]): Promise<Blob> {
  // pdf-lib is large; load it only when the user exports.
  const lib = await import('pdf-lib');
  rgb = lib.rgb;
  const pdf = await lib.PDFDocument.create();
  pdf.setTitle(notebook.name);
  pdf.setCreator('Noteboard');
  for (const page of pages) {
    const pdfPage = pdf.addPage([page.width * PT, page.height * PT]);
    drawTemplatePdf(pdfPage, page.template, page.width, page.height);
    const ordered = [...page.strokes.filter((s) => s.tool === 'highlighter'), ...page.strokes.filter((s) => s.tool !== 'highlighter')];
    for (const stroke of ordered) {
      const path = outlineToSvgPath(strokeOutline(stroke, true));
      if (!path) continue;
      pdfPage.drawSvgPath(path, {
        x: 0,
        y: page.height * PT,
        scale: PT,
        color: hexToRgb(stroke.color),
        opacity: stroke.tool === 'highlighter' ? 0.35 : 1,
        borderWidth: 0,
      });
    }
  }
  const bytes = await pdf.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

/** High-resolution PNG of one page, including the paper template. */
export async function exportPagePng(page: Page, pixelScale = 2): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(page.width * pixelScale);
  canvas.height = Math.round(page.height * pixelScale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const m = TEMPLATE_METRICS;
  ctx.strokeStyle = m.lineColor;
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
  const ink = document.createElement('canvas');
  ink.width = canvas.width;
  ink.height = canvas.height;
  drawPage(ink.getContext('2d')!, page.strokes, { x: 0, y: 0, width: page.width, height: page.height, k: pixelScale });
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
    pages: await db.pages.toArray(),
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

/** Merges a backup into the library (never overwrites newer local work or loses ink). */
export async function importBackup(db: NoteboardDB, file: Blob): Promise<number> {
  const backup = JSON.parse(await file.text()) as Backup;
  if (backup.app !== 'noteboard' || !Array.isArray(backup.items)) throw new Error('This is not a Noteboard backup.');
  await db.transaction('rw', db.items, db.pages, db.meta, async () => {
    const { merged } = mergeLibrary(await db.items.toArray(), backup.items);
    await db.items.bulkPut(merged);
    for (const page of backup.pages) {
      const local = await db.pages.get(page.id);
      await db.pages.put({ ...(local ? mergePage(local, page) : page), dirty: 1 });
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

export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Notebook';
}
