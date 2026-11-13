import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ID, StrokeLink } from '../model/types';

/**
 * Links: on any item (web address, another page, another notebook), and the links that are
 * already inside imported PDFs (web links and jumps to other PDF pages).
 */

/** Cleans up a typed web address ("example.com" → "https://example.com"). Null if it isn't one. */
export function normalizeUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(text)) return text;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Short text for a link ("example.com/page", "Page 3", "Notebook"). */
export function describeLink(link: StrokeLink, pageNumber?: (id: ID) => number | undefined, notebookName?: (id: ID) => string | undefined): string {
  if (link.kind === 'url') {
    try {
      const u = new URL(link.url);
      return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
    } catch {
      return link.url;
    }
  }
  if (link.kind === 'page') {
    const n = pageNumber?.(link.pageId);
    return n ? `Page ${n}` : 'A page';
  }
  return notebookName?.(link.notebookId) ?? 'A notebook';
}

/** Requests to follow a link (handled by the notebook editor). */
export const FOLLOW_LINK = 'noteboard-follow-link';
export type FollowRequest = StrokeLink | { kind: 'pdfPage'; fileId: ID; pageIndex: number };

export function followLink(link: FollowRequest): void {
  window.dispatchEvent(new CustomEvent<FollowRequest>(FOLLOW_LINK, { detail: link }));
}

/** A link area of an imported PDF page, in page units. */
export interface PdfLinkArea {
  x: number;
  y: number;
  width: number;
  height: number;
  url?: string;
  /** 0-based PDF page the link jumps to. */
  pageIndex?: number;
}

const cache = new Map<string, Promise<PdfLinkArea[]>>();

/** The links on one PDF page, scaled to a Noteboard page of the given size. Cached. */
export function pdfLinks(doc: PDFDocumentProxy, fileId: ID, pageIndex: number, width: number, height: number): Promise<PdfLinkArea[]> {
  const key = `${fileId}|${pageIndex}|${width}|${height}`;
  let found = cache.get(key);
  if (!found) {
    found = (async () => {
      const pdfPage = await doc.getPage(pageIndex + 1);
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: width / base.width });
      const out: PdfLinkArea[] = [];
      for (const a of await pdfPage.getAnnotations()) {
        if (a.subtype !== 'Link' || !Array.isArray(a.rect)) continue;
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect as number[]) as number[];
        const sy = height / viewport.height || 1;
        const area: PdfLinkArea = {
          x: Math.min(x1!, x2!),
          y: Math.min(y1!, y2!) * sy,
          width: Math.abs(x2! - x1!),
          height: Math.abs(y2! - y1!) * sy,
        };
        if (typeof a.url === 'string' && normalizeUrl(a.url)) area.url = normalizeUrl(a.url)!;
        else if (a.dest) {
          try {
            const dest = typeof a.dest === 'string' ? await doc.getDestination(a.dest) : (a.dest as unknown[]);
            const ref = dest?.[0];
            if (ref && typeof ref === 'object') area.pageIndex = await doc.getPageIndex(ref as { num: number; gen: number });
            else if (typeof ref === 'number') area.pageIndex = ref;
          } catch {
            continue;
          }
        } else continue;
        out.push(area);
      }
      return out;
    })().catch(() => []);
    cache.set(key, found);
  }
  return found;
}
