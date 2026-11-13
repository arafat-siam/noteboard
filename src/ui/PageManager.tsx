import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { db } from '../db/db';
import { addPage, deletePages, loadPage, loadPages, movePages, pastePages } from '../db/pages';
import { getClip, onClipChange, setClip } from '../ink/clipboard';
import { preloadImages } from '../ink/images';
import { drawPage } from '../ink/render';
import { templateStyle } from '../ink/templates';
import { inkIsDark } from '../ink/inkTheme';
import { getPdf, renderPdfRegion } from '../pdf/pdf';
import type { ID, Page } from '../model/types';
import { sync } from '../sync/instance';
import { Icon } from './Icon';

/** Thumbnail width in CSS pixels. */
const THUMB = 150;

/**
 * Drawboard-style page manager: every page of the notebook as a thumbnail. Select pages (tap),
 * then copy / cut / paste (also into other notebooks), duplicate, delete, add, or drag to reorder.
 */
export function PageManager(props: {
  notebookId: ID;
  pageIds: ID[];
  onOpenPage: (pageId: ID) => void;
  /** Export the selected pages (opens the export dialog). */
  onExport?: (pageIds: ID[]) => void;
  onClose: () => void;
}) {
  const { notebookId, pageIds } = props;
  const [selected, setSelected] = useState<ID[]>([]);
  const [clipPages, setClipPages] = useState(() => (getClip()?.kind === 'pages' ? getClip() : null));
  const [drag, setDrag] = useState<{ ids: ID[]; over: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef(new Map<ID, HTMLDivElement>());
  const press = useRef<{ id: ID; x: number; y: number; pointerId: number; timer: number | null; started: boolean } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  useEffect(() => onClipChange(() => setClipPages(getClip()?.kind === 'pages' ? getClip() : null)), []);
  // Pages deleted elsewhere drop out of the selection.
  useEffect(() => setSelected((s) => s.filter((id) => pageIds.includes(id))), [pageIds]);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 2200);
    return () => clearTimeout(t);
  }, [notice]);

  // While dragging a page with a finger, stop the grid from scrolling.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const block = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };
    grid.addEventListener('touchmove', block, { passive: false });
    return () => grid.removeEventListener('touchmove', block);
  }, []);

  const ordered = (ids: ID[]) => pageIds.filter((id) => ids.includes(id));
  const lastSelectedIndex = () => Math.max(-1, ...selected.map((id) => pageIds.indexOf(id)));
  const done = (message: string) => {
    sync.syncSoon();
    setNotice(message);
  };
  const plural = (n: number) => `${n} page${n === 1 ? '' : 's'}`;

  const copy = async () => {
    const pages = (await loadPages(db, ordered(selected))).filter((p): p is Page => !!p);
    setClip({ kind: 'pages', pages });
    setNotice(`Copied ${plural(pages.length)} — open any notebook's pages to paste`);
  };
  const cut = async () => {
    if (selected.length >= pageIds.length) {
      alert('A notebook needs at least one page. Copy them instead, or add a page first.');
      return;
    }
    await copy();
    const n = await deletePages(db, notebookId, selected);
    setSelected([]);
    done(`Cut ${plural(n)}`);
  };
  const paste = async () => {
    const clip = getClip();
    if (clip?.kind !== 'pages') return;
    const at = selected.length ? lastSelectedIndex() + 1 : pageIds.length;
    const ids = await pastePages(db, clip.pages, notebookId, at);
    setSelected(ids);
    done(`Pasted ${plural(ids.length)}`);
  };
  const duplicate = async () => {
    const pages = (await loadPages(db, ordered(selected))).filter((p): p is Page => !!p);
    const ids = await pastePages(db, pages, notebookId, lastSelectedIndex() + 1);
    setSelected(ids);
    done(`Duplicated ${plural(ids.length)}`);
  };
  const remove = async () => {
    if (!confirm(`Delete ${plural(selected.length)}?`)) return;
    const n = await deletePages(db, notebookId, selected);
    setSelected([]);
    done(`Deleted ${plural(n)}`);
  };
  const add = async () => {
    const after = selected.length ? pageIds[lastSelectedIndex()] : undefined;
    const page = await addPage(db, notebookId, after);
    if (page) setSelected([page.id]);
    done('Added a blank page');
  };

  const toggle = (id: ID) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  // ---- Drag to reorder (finger: hold first; Pencil / mouse: just drag) ---------------------
  const dropIndexAt = (x: number, y: number) => {
    let best = pageIds.length;
    let bestDistance = Infinity;
    pageIds.forEach((id, i) => {
      const r = thumbRefs.current.get(id)?.getBoundingClientRect();
      if (!r) return;
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d < bestDistance) {
        bestDistance = d;
        best = x > r.left + r.width / 2 ? i + 1 : i;
      }
    });
    return best;
  };

  const onPointerDown = (e: React.PointerEvent, id: ID) => {
    if (e.button > 0) return;
    const start = () => {
      if (!press.current) return;
      press.current.started = true;
      const ids = selected.includes(id) ? ordered(selected) : [id];
      setDrag({ ids, over: pageIds.indexOf(id) });
      navigator.vibrate?.(8);
    };
    press.current = {
      id,
      x: e.clientX,
      y: e.clientY,
      pointerId: e.pointerId,
      started: false,
      timer: e.pointerType === 'touch' ? window.setTimeout(start, 350) : null,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (!p.started) {
      const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8;
      if (!moved) return;
      if (e.pointerType === 'touch') {
        // Moved before the hold: it's a scroll, not a drag.
        if (p.timer) clearTimeout(p.timer);
        press.current = null;
        return;
      }
      p.started = true;
      const ids = selected.includes(p.id) ? ordered(selected) : [p.id];
      setDrag({ ids, over: dropIndexAt(e.clientX, e.clientY) });
      return;
    }
    setDrag((d) => (d ? { ...d, over: dropIndexAt(e.clientX, e.clientY) } : d));
  };
  const onPointerUp = (e: React.PointerEvent, id: ID, cancelled = false) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (p.timer) clearTimeout(p.timer);
    press.current = null;
    const d = dragRef.current;
    if (p.started && d) {
      setDrag(null);
      if (cancelled) return;
      // Index among the pages that aren't moving.
      const moving = new Set(d.ids);
      const toIndex = pageIds.slice(0, d.over).filter((x) => !moving.has(x)).length;
      void movePages(db, notebookId, d.ids, toIndex).then(() => done(`Moved ${plural(d.ids.length)}`));
      return;
    }
    if (!cancelled) toggle(id);
  };

  const one = selected.length === 1 ? selected[0]! : null;
  const has = selected.length > 0;

  return (
    <div className="page-manager" role="dialog" aria-label="Pages">
      <header className="toolbar page-manager-top">
        <button className="text-button" onClick={props.onClose}>
          Done
        </button>
        <strong>Pages</strong>
        <span className="muted">{has ? `${selected.length} selected` : `${pageIds.length} pages · tap to select, drag to move`}</span>
        <div className="spacer" />
        <button className="text-button" onClick={() => setSelected(selected.length === pageIds.length ? [] : [...pageIds])}>
          {selected.length === pageIds.length ? 'Select None' : 'Select All'}
        </button>
      </header>

      <div className="page-manager-actions" role="toolbar" aria-label="Page actions">
        <button disabled={!one} onClick={() => one && props.onOpenPage(one)}>Open</button>
        <button disabled={!has} onClick={() => void copy()}>Copy</button>
        <button disabled={!has} onClick={() => void cut()}>Cut</button>
        <button disabled={!clipPages} onClick={() => void paste()}>
          Paste{clipPages?.kind === 'pages' ? ` (${clipPages.pages.length})` : ''}
          {has ? ' after' : ''}
        </button>
        <button disabled={!has} onClick={() => void duplicate()}>Duplicate</button>
        {props.onExport && (
          <button disabled={!has} onClick={() => props.onExport?.(ordered(selected))}>
            Export{has ? ` (${selected.length})` : ''}
          </button>
        )}
        <button onClick={() => void add()}>Add page</button>
        <button className="danger-text" disabled={!has || selected.length >= pageIds.length} onClick={() => void remove()}>
          Delete
        </button>
      </div>

      <div ref={gridRef} className="page-grid">
        {pageIds.map((id, i) => (
          <div
            key={id}
            ref={(el) => {
              if (el) thumbRefs.current.set(id, el);
              else thumbRefs.current.delete(id);
            }}
            className={[
              'page-thumb',
              selected.includes(id) ? 'selected' : '',
              drag?.ids.includes(id) ? 'dragging' : '',
              drag && drag.over === i ? 'drop-before' : '',
              drag && drag.over === i + 1 && i === pageIds.length - 1 ? 'drop-after' : '',
            ].join(' ')}
            onPointerDown={(e) => onPointerDown(e, id)}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => onPointerUp(e, id)}
            onPointerCancel={(e) => onPointerUp(e, id, true)}
            onDoubleClick={() => props.onOpenPage(id)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <PageThumbnail pageId={id} />
            <span className="page-thumb-number">{i + 1}</span>
            <span className="page-thumb-check" aria-hidden="true">
              {selected.includes(id) && <Icon name="check" size={14} />}
            </span>
          </div>
        ))}
      </div>

      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}

/** A small picture of a page (paper, PDF page, pictures and ink), drawn when it scrolls into view. */
function PageThumbnail({ pageId }: { pageId: ID }) {
  const record = useLiveQuery(() => db.pages.get(pageId), [pageId]);
  const strokeCount = useLiveQuery(() => db.strokes.where('pageId').equals(pageId).count(), [pageId]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const holderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => entry?.isIntersecting && setVisible(true), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const k = record ? THUMB / record.width : 1;
  const updatedAt = record?.updatedAt;

  useEffect(() => {
    if (!visible || !record) return;
    let cancelled = false;
    void (async () => {
      const page = await loadPage(db, pageId);
      const canvas = canvasRef.current;
      if (!page || !canvas || cancelled) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const px = k * dpr;
      canvas.width = Math.round(page.width * px);
      canvas.height = Math.round(page.height * px);
      const ctx = canvas.getContext('2d')!;
      const region = { x: 0, y: 0, width: page.width, height: page.height, k: px };
      if (page.background) {
        const doc = await getPdf(db, page.background.fileId);
        if (doc && !cancelled) {
          const { canvas: rendered, task } = await renderPdfRegion(doc, page.background.pageIndex, region, canvas.width, canvas.height);
          await task.promise.catch(() => undefined);
          if (cancelled) return;
          ctx.drawImage(rendered, 0, 0);
        }
      }
      await preloadImages(page.strokes);
      if (cancelled) return;
      const ink = document.createElement('canvas');
      ink.width = canvas.width;
      ink.height = canvas.height;
      drawPage(ink.getContext('2d')!, page.strokes, region);
      ctx.drawImage(ink, 0, 0);
    })();
    return () => {
      cancelled = true;
    };
    // Redraw when the page changes.
  }, [visible, pageId, updatedAt, strokeCount, k, record?.template, record?.background?.fileId]);

  const width = THUMB;
  const height = record ? record.height * k : THUMB * 1.414;
  return (
    <div
      ref={holderRef}
      className="page-thumb-paper"
      style={{ width, height, ...(record && !record.background ? templateStyle(record.template, k, inkIsDark()) : { background: inkIsDark() ? '#1c1d21' : '#fff' }) }}
    >
      <canvas ref={canvasRef} style={{ width, height }} />
    </div>
  );
}
