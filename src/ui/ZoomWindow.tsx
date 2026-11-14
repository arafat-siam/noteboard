import { useEffect, useRef, useState } from 'react';
import { db } from '../db/db';
import { applyEdit, loadPage, onLocalEdit } from '../db/pages';
import { applyRegion, drawPage, drawStroke, type CanvasRegion } from '../ink/render';
import type { ToolSettings } from '../ink/InkPage';
import { newId, type Page, type Stroke } from '../model/types';
import { Icon } from './Icon';

/** How much bigger writing is in the window than on the page (css px per page unit). */
const ZOOM = 2.6;
/** Page margin kept clear on the left when moving to a new line (page units). */
const LEFT = 48;

/**
 * Zoom writing window (like GoodNotes/Notability): a magnified strip at the bottom of the
 * screen. Writing in it lands, small and neat, inside the frame shown on the page. The frame
 * moves on by itself when the writing reaches the right side, and "New line" starts the next line.
 */
export function ZoomWindow(props: {
  pageId: string;
  settings: ToolSettings;
  onCommit: (pageId: string, strokes: Stroke[]) => void;
  onClose: () => void;
}) {
  const { pageId, settings } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [size, setSize] = useState({ w: 600, h: 190 });
  // Frame on the page (page units): where the window's writing lands.
  const [frame, setFrame] = useState<{ x: number; y: number } | null>(null);
  const drawing = useRef<{ id: number; points: number[] } | null>(null);

  const fw = size.w / ZOOM; // frame size in page units
  const fh = size.h / ZOOM;

  useEffect(() => {
    let alive = true;
    const load = () => void loadPage(db, pageId).then((p) => alive && p && setPage(p));
    load();
    // Own edits arrive before they are saved: apply them in memory (like the pages do).
    const stop = onLocalEdit((edit) => {
      if (edit.pageId !== pageId) return;
      if (edit.failed) load();
      else setPage((p) => (p ? applyEdit(p, edit) : p));
    });
    return () => {
      alive = false;
      stop();
    };
  }, [pageId]);

  // Start at the top-left writing area of the page.
  useEffect(() => {
    if (page && !frame) setFrame({ x: LEFT, y: Math.min(page.height - fh, 80) });
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const region = (): CanvasRegion | null => (frame ? { x: frame.x, y: frame.y, width: fw, height: fh, k: ZOOM * dpr } : null);

  // Draw the page's ink inside the frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    const r = region();
    if (!canvas || !page || !r) return;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d')!;
    drawPage(ctx, page.strokes, r);
  }, [page, frame, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the frame on the page.
  useEffect(() => {
    if (!frame || !page) return;
    const pageIndexEl = [...document.querySelectorAll<HTMLElement>('.ink-page')].find((el) => el.closest('[data-page-id]')?.getAttribute('data-page-id') === pageId);
    const target = pageIndexEl ?? null;
    if (!target) return;
    const scale = target.getBoundingClientRect().width / page.width;
    const box = document.createElement('div');
    box.className = 'zoom-frame';
    Object.assign(box.style, { left: `${frame.x * scale}px`, top: `${frame.y * scale}px`, width: `${fw * scale}px`, height: `${fh * scale}px` });
    target.appendChild(box);
    return () => box.remove();
  }, [frame, page, fw, fh, pageId]);

  const toPage = (e: React.PointerEvent) => {
    const rect = liveRef.current!.getBoundingClientRect();
    return [frame!.x + (e.clientX - rect.left) / ZOOM, frame!.y + (e.clientY - rect.top) / ZOOM, e.pressure || 0.5];
  };
  const stroke = (points: number[], id = 'live'): Stroke => {
    const highlighter = settings.tool === 'highlighter';
    return {
      id,
      tool: highlighter ? 'highlighter' : 'pen',
      color: highlighter ? settings.highlighterColor : settings.color,
      size: highlighter ? settings.highlighterSize : settings.penSize,
      points,
      hasPressure: true,
      createdAt: Date.now(),
      ...(highlighter ? {} : { brush: settings.penBrush }),
      ...(!highlighter && settings.penStyle && Object.keys(settings.penStyle).length ? { penStyle: settings.penStyle } : {}),
    };
  };
  const drawLive = () => {
    const canvas = liveRef.current;
    const r = region();
    const d = drawing.current;
    if (!canvas || !r) return;
    if (canvas.width !== Math.round(size.w * dpr)) {
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!d) return;
    applyRegion(ctx, r);
    drawStroke(ctx, stroke(d.points), true);
  };

  const onDown = (e: React.PointerEvent) => {
    if (!frame || e.pointerType === 'touch') return; // fingers never write here (palm rejection)
    e.preventDefault();
    try {
      liveRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // Capture only keeps a stroke going past the edge; never let it block writing.
    }
    drawing.current = { id: e.pointerId, points: toPage(e) };
    drawLive();
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    const coalesced = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const events = coalesced.length ? coalesced : [e.nativeEvent];
    const rect = liveRef.current!.getBoundingClientRect();
    for (const ev of events) d.points.push(frame!.x + (ev.clientX - rect.left) / ZOOM, frame!.y + (ev.clientY - rect.top) / ZOOM, ev.pressure || 0.5);
    drawLive();
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    drawing.current = null;
    if (d.points.length === 3) d.points.push(d.points[0]! + 0.1, d.points[1]! + 0.1, d.points[2]!);
    props.onCommit(pageId, [stroke(d.points, newId())]);
    drawLive();
    // Writing reached the right side: move the frame on, keeping a little overlap.
    let maxX = -Infinity;
    for (let i = 0; i < d.points.length; i += 3) maxX = Math.max(maxX, d.points[i]!);
    if (frame && page && maxX > frame.x + fw * 0.78) {
      const nextX = frame.x + fw * 0.6;
      if (nextX + fw * 0.5 > page.width) newLine();
      else setFrame({ ...frame, x: Math.min(nextX, page.width - fw) });
    }
  };

  const newLine = () =>
    setFrame((f) => (f && page ? { x: LEFT, y: Math.min(page.height - fh, f.y + fh * 0.75) } : f));
  const shift = (dx: number, dy: number) =>
    setFrame((f) => (f && page ? { x: Math.max(0, Math.min(page.width - fw, f.x + dx)), y: Math.max(0, Math.min(page.height - fh, f.y + dy)) } : f));

  return (
    <div className="zoom-window" role="region" aria-label="Zoom writing window">
      <div className="zoom-controls-bar">
        <button className="header-icon" aria-label="Move left" title="Move left" onClick={() => shift(-fw * 0.5, 0)}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <button className="header-icon" aria-label="Move up" title="Move up" onClick={() => shift(0, -fh * 0.5)}>
          <Icon name="chevronUp" size={20} />
        </button>
        <button className="header-icon" aria-label="Move down" title="Move down" onClick={() => shift(0, fh * 0.5)}>
          <Icon name="chevronDown" size={20} />
        </button>
        <button className="header-icon" aria-label="Move right" title="Move right" onClick={() => shift(fw * 0.5, 0)}>
          <Icon name="chevronRight" size={20} />
        </button>
        <button className="secondary zoom-newline" onClick={newLine}>
          New line
        </button>
        <span className="spacer" />
        <button className="header-icon" aria-label="Close zoom window" title="Close" onClick={props.onClose}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="zoom-surface" ref={holderRef}>
        <canvas ref={canvasRef} className="zoom-ink" style={{ width: size.w, height: size.h }} />
        <canvas
          ref={liveRef}
          className="zoom-live"
          style={{ width: size.w, height: size.h }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        <span className="zoom-baseline" aria-hidden="true" />
        <span className="zoom-advance" aria-hidden="true" />
      </div>
    </div>
  );
}
