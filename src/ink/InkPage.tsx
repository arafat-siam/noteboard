import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { newId, type Page, type Stroke } from '../model/types';
import { applyRegion, drawPage, drawStroke, type CanvasRegion } from './render';
import { adjustShape, recognizeShape, type ShapeKind } from './shapes';
import {
  boundsOf,
  rectContains,
  strokeBounds,
  strokeHit,
  strokeInLasso,
  strokePoints,
  translateStroke,
  scaleStroke,
  recolorStroke,
  rotateStroke,
  unionRects,
  type Point,
  type Rect,
} from './geometry';
import { eraseFromStroke } from './erase';
import type { BrushKind } from './brushes';
import { PEN_COLORS, type PenSlot } from './palette';
import { templateStyle } from './templates';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { getPdf, renderPdfRegion } from '../pdf/pdf';
import { notePen, penActiveWithin } from './penState';
import { diagnostics, recordEvent, recordFrame } from './diagnostics';
import { hideHoverCursor, showHoverCursor } from './hoverCursor';

export type ToolKind = 'pen' | 'highlighter' | 'eraser' | 'lasso';

export interface ToolSettings {
  tool: ToolKind;
  color: string;
  highlighterColor: string;
  penSize: number;
  highlighterSize: number;
  eraserSize: number;
  shapeSnap: boolean;
  fingerDraws: boolean;
  /** Hold the hovering Pencil still to open the quick tool palette. */
  hoverPalette: boolean;
  /** Show the hover cursor for pens (on unless turned off; the eraser ring always shows). */
  hoverPreview?: boolean;
  /** Pen type used by the pen tool. */
  penBrush: BrushKind;
  /** Eraser removes whole strokes, or only the ink under it. */
  eraserMode: 'stroke' | 'partial';
  /** The user's pens (tray order) and which one is in hand. color/penSize/... mirror it. */
  slots: PenSlot[];
  activeSlot: string;
}

interface Props {
  page: Page;
  /** CSS pixels per page unit. */
  scale: number;
  settings: ToolSettings;
  /** The scrolling element; canvases cover only the part of the page visible in it. */
  scroller: HTMLElement | null;
  onChange: (pageId: string, added: Stroke[], removedIds: string[]) => void;
  /** Pencil hovered still above the page (client coordinates). */
  onHoverHold?: (clientX: number, clientY: number) => void;
  /** A finger long-press selected ink: switch to the lasso tool so the selection can be edited. */
  onRequestSelect?: () => void;
}

interface Gesture {
  pointerId: number;
  kind: 'ink' | 'erase' | 'lasso' | 'move' | 'scale' | 'rotate';
  /** Page position on screen at gesture start; reading layout on every sample would stall the pen. */
  origin: { left: number; top: number };
  points: number[];
  hasPressure: boolean;
  predicted: number[];
  /** Union of everything drawn on the live layer this gesture (page units), for partial clears. */
  dirty: Rect | null;
  needsDraw: boolean;
  lastSampleAt: number;
  holdAnchor: Point;
  holdSince: number;
  snapped: boolean;
  erased: Set<string>;
  lasso: Point[];
  moveStart: Point;
  offset: Point;
  /** Partial eraser: original stroke id -> the pieces left of it so far. */
  pieces: Map<string, Stroke[]>;
  /** Resizing a selection: fixed corner, the dragged corner's start, current factor. */
  anchor: Point;
  scaleFrom: Point;
  factor: number;
  /** Rotating a selection: pointer angle at start and current rotation (radians). */
  startAngle: number;
  angle: number;
  /** Snapped shape that keeps following the Pencil until it lifts (Drawboard-style). */
  shape: { kind: ShapeKind; base: Point[]; from: Point; pressure: number } | null;
}

interface Selection {
  ids: Set<string>;
  bounds: Rect;
}

const HOLD_TO_SNAP_MS = 500;
type Corner = 'nw' | 'ne' | 'se' | 'sw';
type Handle = Corner | 'rotate';
const LONG_PRESS_MS = 480;

const HOVER_HOLD_MS = 900;
/** Extra area rendered around the visible part, so small scrolls need no redraw. */
const VIEW_MARGIN = 0.3;
/** iPad Safari refuses canvases above ~16.7M pixels; stay well under per canvas. */
const MAX_CANVAS_PIXELS = 10_000_000;

function getLiveContext(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  // `desynchronized` lets browsers that support it skip the compositor for lower latency.
  return canvas?.getContext('2d', { desynchronized: true }) as CanvasRenderingContext2D | null;
}

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5;

export function InkPage({ page, scale, settings, scroller, onChange, onHoverHold, onRequestSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const hiddenRef = useRef<Set<string>>(new Set());
  const frameRef = useRef<number | null>(null);
  const hoverRef = useRef<{ x: number; y: number; timer: number | null } | null>(null);
  const pressRef = useRef<{ id: number; x: number; y: number; timer: number } | null>(null);
  const selectionBoxRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Imported PDF page under the ink.
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const pdfRenderRef = useRef<{ task: RenderTask | null; generation: number }>({ task: null, generation: 0 });
  const [pdfMissing, setPdfMissing] = useState(false);
  // Stable identity (the page object is re-read after every save; the PDF behind it isn't).
  const bgFile = page.background?.fileId;
  const bgIndex = page.background?.pageIndex;
  const background = useMemo(
    () => (bgFile !== undefined && bgIndex !== undefined ? { kind: 'pdf' as const, fileId: bgFile, pageIndex: bgIndex } : undefined),
    [bgFile, bgIndex],
  );
  /** Which part of the page the canvases currently show, at what resolution. */
  const regionRef = useRef<CanvasRegion | null>(null);
  /** What is painted on the ink canvas, to skip needless full redraws. */
  const paintedRef = useRef<{ region: CanvasRegion | null; ids: Set<string> }>({ region: null, ids: new Set() });
  const strokesRef = useRef(page.strokes);
  strokesRef.current = page.strokes;
  const [selection, setSelection] = useState<Selection | null>(null);

  const cssWidth = page.width * scale;
  const cssHeight = page.height * scale;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  diagnostics.devicePixelRatio = dpr;

  // ---- Rendering ---------------------------------------------------------------------------
  const paintInk = useCallback((force = false) => {
    const canvas = inkRef.current;
    const region = regionRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !region) return;
    const strokes = strokesRef.current;
    const hidden = hiddenRef.current;
    const painted = paintedRef.current;
    // Fast path: a committed stroke was already painted, so the saved page coming back from
    // the database needs no repaint.
    const unchanged =
      !force &&
      painted.region === region &&
      hidden.size === 0 &&
      painted.ids.size === strokes.length &&
      strokes.every((s) => painted.ids.has(s.id));
    if (unchanged) return;
    drawPage(ctx, strokes, region, hidden);
    paintedRef.current = {
      region,
      ids: hidden.size ? new Set() : new Set(strokes.map((s) => s.id)),
    };
  }, []);

  /** Draws the visible part of the PDF page; the previous image stays until the new one is ready. */
  const renderPdf = useCallback(async () => {
    const doc = pdfDocRef.current;
    const region = regionRef.current;
    const target = pdfCanvasRef.current;
    if (!doc || !region || !target || !background) return;
    const state = pdfRenderRef.current;
    state.task?.cancel();
    const generation = ++state.generation;
    const pixelWidth = Math.max(1, Math.ceil(region.width * region.k));
    const pixelHeight = Math.max(1, Math.ceil(region.height * region.k));
    try {
      const { canvas, task } = await renderPdfRegion(doc, background.pageIndex, region, pixelWidth, pixelHeight);
      if (generation !== state.generation) return task.cancel();
      state.task = task;
      await task.promise;
      if (generation !== state.generation) return;
      target.width = pixelWidth;
      target.height = pixelHeight;
      target.style.left = `${region.x * scale}px`;
      target.style.top = `${region.y * scale}px`;
      target.style.width = `${(pixelWidth / region.k) * scale}px`;
      target.style.height = `${(pixelHeight / region.k) * scale}px`;
      target.getContext('2d')!.drawImage(canvas, 0, 0);
    } catch {
      // Cancelled by a newer render, or a broken page: keep whatever is showing.
    }
  }, [background, scale]);

  /** Sizes the canvases to the visible part of the page (+ margin) at full screen sharpness. */
  const layout = useCallback(
    (force = false) => {
      const container = containerRef.current;
      if (!container || !scroller) return;
      const pr = container.getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      const toPage = (left: number, top: number, right: number, bottom: number): Rect => ({
        x: (left - pr.left) / scale,
        y: (top - pr.top) / scale,
        width: (right - left) / scale,
        height: (bottom - top) / scale,
      });
      const visibleLeft = Math.max(pr.left, sr.left);
      const visibleRight = Math.min(pr.right, sr.right);
      const visibleTop = Math.max(pr.top, sr.top);
      const visibleBottom = Math.min(pr.bottom, sr.bottom);
      const mx = sr.width * VIEW_MARGIN;
      const my = sr.height * VIEW_MARGIN;
      const left = Math.max(pr.left, sr.left - mx);
      const right = Math.min(pr.right, sr.right + mx);
      const top = Math.max(pr.top, sr.top - my);
      const bottom = Math.min(pr.bottom, sr.bottom + my);

      const canvases = [inkRef.current, liveRef.current].filter((c): c is HTMLCanvasElement => !!c);
      if (right <= left || bottom <= top) {
        // Far from view: free the canvas memory.
        if (regionRef.current) {
          for (const c of canvases) c.width = c.height = 0;
          pdfRenderRef.current.task?.cancel();
          pdfRenderRef.current.generation++;
          if (pdfCanvasRef.current) pdfCanvasRef.current.width = pdfCanvasRef.current.height = 0;
          regionRef.current = null;
          paintedRef.current = { region: null, ids: new Set() };
        }
        return;
      }

      const needed = toPage(left, top, right, bottom);
      const want = scale * dpr;
      const k = Math.min(want, Math.sqrt(MAX_CANVAS_PIXELS / (needed.width * needed.height)));
      const current = regionRef.current;
      const visible =
        visibleRight > visibleLeft && visibleBottom > visibleTop
          ? toPage(visibleLeft, visibleTop, visibleRight, visibleBottom)
          : needed;
      if (!force && current && Math.abs(current.k - k) < 1e-6 && contains(current, visible)) return;

      const region: CanvasRegion = { ...needed, k };
      regionRef.current = region;
      const pixelWidth = Math.max(1, Math.ceil(region.width * k));
      const pixelHeight = Math.max(1, Math.ceil(region.height * k));
      for (const c of canvases) {
        c.width = pixelWidth;
        c.height = pixelHeight;
        c.style.left = `${region.x * scale}px`;
        c.style.top = `${region.y * scale}px`;
        c.style.width = `${(pixelWidth / k) * scale}px`;
        c.style.height = `${(pixelHeight / k) * scale}px`;
      }
      diagnostics.canvasPixels = pixelWidth * pixelHeight;
      paintInk(true);
      void renderPdf();
    },
    [scroller, scale, dpr, paintInk, renderPdf],
  );

  // Re-open once a PDF that was still syncing arrives on this device.
  const pdfAvailable = useLiveQuery(
    async () => (background ? (await db.files.where('id').equals(background.fileId).count()) > 0 : false),
    [background],
  );

  // Open the PDF behind this page (if any).
  useEffect(() => {
    if (!background) return;
    let alive = true;
    void getPdf(db, background.fileId).then((doc) => {
      if (!alive) return;
      pdfDocRef.current = doc;
      setPdfMissing(!doc);
      void renderPdf();
    });
    return () => {
      alive = false;
      pdfRenderRef.current.task?.cancel();
    };
  }, [background, renderPdf, pdfAvailable]);

  // Re-layout when zoom changes (before paint, so nothing flashes) …
  useLayoutEffect(() => {
    layout(true);
  }, [layout]);

  // … and when scrolling or resizing.
  useEffect(() => {
    if (!scroller) return;
    let raf: number | null = null;
    const onScroll = () => {
      if (raf == null) {
        raf = requestAnimationFrame(() => {
          raf = null;
          if (!gestureRef.current) layout();
        });
      }
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(() => layout());
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      observer.disconnect();
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [scroller, layout]);

  // New strokes from the database (or undo, sync…).
  useEffect(() => {
    if (!gestureRef.current && hiddenRef.current.size) {
      hiddenRef.current = new Set();
      paintInk(true);
    } else {
      paintInk();
    }
  }, [page.strokes, paintInk]);

  useEffect(() => {
    if (settings.tool === 'eraser') setSelection(null);
  }, [settings.tool]);

  useEffect(() => {
    setSelection((sel) => {
      if (!sel) return sel;
      return page.strokes.some((s) => sel.ids.has(s.id)) ? sel : null;
    });
  }, [page.strokes]);

  const pressureOf = (e: PointerEvent) => (e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 0.5);

  const liveStroke = (g: Gesture, withPrediction: boolean): Stroke => {
    const highlighter = settings.tool === 'highlighter';
    return {
      id: 'live',
      tool: highlighter ? 'highlighter' : 'pen',
      color: highlighter ? settings.highlighterColor : settings.color,
      size: highlighter ? settings.highlighterSize : settings.penSize,
      points: withPrediction && !g.snapped ? g.points.concat(g.predicted) : g.points,
      hasPressure: g.hasPressure,
      createdAt: Date.now(),
      ...(highlighter ? {} : { brush: settings.penBrush }),
    };
  };

  const growDirty = (g: Gesture, x: number, y: number) => {
    const pad = Math.max(settings.penSize, settings.highlighterSize) * 2 + 4;
    if (!g.dirty) g.dirty = { x: x - pad, y: y - pad, width: pad * 2, height: pad * 2 };
    else {
      const minX = Math.min(g.dirty.x, x - pad);
      const minY = Math.min(g.dirty.y, y - pad);
      const maxX = Math.max(g.dirty.x + g.dirty.width, x + pad);
      const maxY = Math.max(g.dirty.y + g.dirty.height, y + pad);
      g.dirty = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
  };

  const clearLive = (ctx: CanvasRenderingContext2D, area: Rect | null) => {
    const region = regionRef.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!area || !region) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }
    ctx.clearRect(
      Math.floor((area.x - region.x) * region.k) - 2,
      Math.floor((area.y - region.y) * region.k) - 2,
      Math.ceil(area.width * region.k) + 4,
      Math.ceil(area.height * region.k) + 4,
    );
  };

  const renderLive = () => {
    frameRef.current = null;
    const g = gestureRef.current;
    const region = regionRef.current;
    const ctx = getLiveContext(liveRef.current);
    if (!ctx || !region) return;
    if (!g) {
      clearLive(ctx, null);
      return;
    }

    if (g.kind === 'ink') {
      if (settings.shapeSnap && !g.snapped && Date.now() - g.holdSince > HOLD_TO_SNAP_MS && g.points.length > 12) {
        const pts: Point[] = [];
        let pressure = 0;
        for (let i = 0; i < g.points.length; i += 3) {
          pts.push({ x: g.points[i]!, y: g.points[i + 1]! });
          pressure += g.points[i + 2]!;
        }
        const shape = recognizeShape(pts);
        if (shape) {
          const avg = pressure / pts.length;
          g.points = shape.points.flatMap((p) => [p.x, p.y, avg]);
          for (const p of shape.points) growDirty(g, p.x, p.y);
          g.snapped = true;
          g.shape = { kind: shape.kind, base: shape.points, from: pts[pts.length - 1]!, pressure: avg };
          g.needsDraw = true;
        } else {
          g.holdSince = Infinity; // don't retry on every frame
        }
      }
      if (g.needsDraw) {
        const start = performance.now();
        clearLive(ctx, g.dirty);
        applyRegion(ctx, region);
        drawStroke(ctx, liveStroke(g, true), true);
        g.needsDraw = false;
        if (diagnostics.enabled) recordFrame(performance.now() - start, performance.now() - g.lastSampleAt);
      }
      // Keep ticking while the pen is down so hold-to-snap fires even without movement.
      requestRender();
      return;
    }

    clearLive(ctx, null);
    applyRegion(ctx, region);
    if (g.kind === 'lasso' && g.lasso.length > 1) {
      ctx.setLineDash([6 / scale, 5 / scale]);
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = '#2f6fde';
      ctx.beginPath();
      g.lasso.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
    } else if (g.kind === 'move' && selection) {
      ctx.translate(g.offset.x, g.offset.y);
      for (const s of page.strokes) if (selection.ids.has(s.id)) drawStroke(ctx, s);
      setBoxTransform(`translate(${g.offset.x * scale}px, ${g.offset.y * scale}px)`);
    } else if (g.kind === 'scale' && selection) {
      ctx.translate(g.anchor.x, g.anchor.y);
      ctx.scale(g.factor, g.factor);
      ctx.translate(-g.anchor.x, -g.anchor.y);
      for (const s of page.strokes) if (selection.ids.has(s.id)) drawStroke(ctx, s);
      const b = selection.bounds;
      setBoxTransform(`scale(${g.factor})`, `${(g.anchor.x - b.x) * scale}px ${(g.anchor.y - b.y) * scale}px`);
    } else if (g.kind === 'rotate' && selection) {
      ctx.translate(g.anchor.x, g.anchor.y);
      ctx.rotate(g.angle);
      ctx.translate(-g.anchor.x, -g.anchor.y);
      for (const s of page.strokes) if (selection.ids.has(s.id)) drawStroke(ctx, s);
      setBoxTransform(`rotate(${g.angle}rad)`, '50% 50%');
    } else if (g.kind === 'erase' && g.pieces.size) {
      for (const pieces of g.pieces.values()) for (const s of pieces) drawStroke(ctx, s);
    }
  };

  /** Moves the selection frame with the ink during a drag (no React re-render per frame). */
  const setBoxTransform = (transform: string, origin = '0 0') => {
    const box = selectionBoxRef.current;
    if (!box) return;
    box.style.transformOrigin = origin;
    box.style.transform = transform;
  };

  /** Paints strokes on the ink layer right away, so nothing blinks while the save completes. */
  const paintNow = (strokes: Stroke[]) => {
    const ctx = inkRef.current?.getContext('2d');
    const region = regionRef.current;
    if (!ctx || !region) return;
    applyRegion(ctx, region);
    for (const s of strokes) {
      drawStroke(ctx, s);
      paintedRef.current.ids.add(s.id);
    }
  };

  // A new selection (or new bounds) resets the frame's drag transform.
  useLayoutEffect(() => {
    setBoxTransform('');
  }, [selection]);

  // Keep the selection menu fully on screen: flip below when there's no room above (or the
  // tool palette is there), and slide sideways near the left/right edges.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || !selection) return;
    menu.classList.remove('below');
    menu.style.transform = '';
    const view = (scroller ?? document.documentElement).getBoundingClientRect();
    const palette = document.querySelector('.tool-palette.dock-top')?.getBoundingClientRect();
    const topLimit = Math.max(view.top, palette ? palette.bottom : 0) + 8;
    if (menu.getBoundingClientRect().top < topLimit) menu.classList.add('below');
    const r = menu.getBoundingClientRect();
    const right = Math.min(view.right, window.innerWidth) - 8;
    const left = Math.max(view.left, 0) + 8;
    let shift = 0;
    if (r.right > right) shift = right - r.right;
    if (r.left + shift < left) shift = left - r.left;
    if (shift) menu.style.transform = `translateX(${shift}px)`;
  }, [selection, scale, scroller]);

  const requestRender = () => {
    if (frameRef.current == null) frameRef.current = requestAnimationFrame(renderLive);
  };

  const eraseAt = (g: Gesture, p: Point) => {
    const radius = settings.eraserSize / 2;
    let changed = false;
    if (settings.eraserMode === 'partial') {
      for (const s of page.strokes) {
        const current = g.pieces.get(s.id) ?? (g.erased.has(s.id) ? [] : [s]);
        let touched = false;
        const next: Stroke[] = [];
        for (const piece of current) {
          const result = eraseFromStroke(piece, p, radius, newId);
          if (result) touched = true;
          next.push(...(result ?? [piece]));
        }
        if (touched) {
          g.pieces.set(s.id, next);
          hiddenRef.current.add(s.id);
          changed = true;
        }
      }
      if (changed) {
        paintInk(true);
        requestRender();
      }
      return;
    }
    for (const s of page.strokes) {
      if (!g.erased.has(s.id) && strokeHit(s, p, radius)) {
        g.erased.add(s.id);
        hiddenRef.current.add(s.id);
        changed = true;
      }
    }
    if (changed) paintInk(true);
  };

  // ---- Pencil hover (iPad Pro with Apple Pencil 2 / Pro) --------------------------------
  const endHover = () => {
    if (hoverRef.current?.timer != null) clearTimeout(hoverRef.current.timer);
    hoverRef.current = null;
    hideHoverCursor();
  };

  /** The topmost stroke under a point (for tap / long-press selection). */
  const strokeAt = (p: Point): Stroke | undefined => {
    const radius = Math.max(5, 12 / scale);
    for (let i = page.strokes.length - 1; i >= 0; i--) {
      const s = page.strokes[i]!;
      if (strokeHit(s, p, radius)) return s;
    }
    return undefined;
  };

  const selectStroke = (s: Stroke) => {
    const b = strokeBounds(s);
    setSelection({ ids: new Set([s.id]), bounds: b });
  };

  const cancelPress = () => {
    if (pressRef.current) clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  };

  const onHover = (e: React.PointerEvent<HTMLDivElement>) => {
    const tool = settings.tool;
    // Preview exactly where (and how big) ink will land.
    const size =
      tool === 'eraser'
        ? settings.eraserSize * scale
        : tool === 'highlighter'
          ? settings.highlighterSize * scale
          : Math.max(5, settings.penSize * scale);
    if (tool === 'eraser' || settings.hoverPreview !== false) {
      const n = e.nativeEvent as PointerEvent & { azimuthAngle?: number };
      showHoverCursor(e.clientX, e.clientY, {
        tool,
        size,
        color: tool === 'highlighter' ? settings.highlighterColor : settings.color,
        twist: e.twist || 0,
        azimuth: n.azimuthAngle,
      });
    } else {
      hideHoverCursor();
    }

    // Hover-hold palette, but never right after writing (pausing between words isn't a request).
    if (!settings.hoverPalette || !onHoverHold || penActiveWithin(1200)) return;
    const h = hoverRef.current;
    if (!h || Math.hypot(e.clientX - h.x, e.clientY - h.y) > 6) {
      if (h?.timer != null) clearTimeout(h.timer);
      const { clientX, clientY } = e;
      hoverRef.current = {
        x: clientX,
        y: clientY,
        timer: window.setTimeout(() => {
          endHover();
          onHoverHold(clientX, clientY);
        }, HOVER_HOLD_MS),
      };
    }
  };

  useEffect(() => endHover, []);

  // ---- Pointer input (on the page itself; canvases only display) --------------------------
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('button')) return; // selection menu buttons
    endHover();
    const native = e.nativeEvent;
    if (diagnostics.enabled) {
      diagnostics.pointerType = e.pointerType;
      diagnostics.coalescedSupported = typeof native.getCoalescedEvents === 'function';
      diagnostics.predictedSupported = typeof native.getPredictedEvents === 'function';
    }
    if (e.pointerType === 'pen') notePen(true);
    const handle = (e.target as Element).closest('[data-handle]')?.getAttribute('data-handle') as Handle | null;
    const box = containerRef.current!.getBoundingClientRect();
    const at = { x: (e.clientX - box.left) / scale, y: (e.clientY - box.top) / scale };
    const onSelection = !!selection && (!!handle || rectContains(selection.bounds, at));
    // Fingers scroll/zoom (handled by the editor) unless finger drawing is on — but a finger
    // may always move or resize a selection.
    if (e.pointerType === 'touch' && !settings.fingerDraws && !onSelection) {
      // Long-press ink with a finger to select it (any tool), like in Apple Notes.
      cancelPress();
      if (!onRequestSelect) return;
      pressRef.current = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        timer: window.setTimeout(() => {
          pressRef.current = null;
          const hit = strokeAt(at);
          if (!hit) return;
          selectStroke(hit);
          onRequestSelect();
          navigator.vibrate?.(10);
        }, LONG_PRESS_MS),
      };
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (gestureRef.current || !regionRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      containerRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // Capture is an optimisation (keeps strokes going past the page edge); never let it block ink.
    }

    const rect = containerRef.current!.getBoundingClientRect();
    const origin = { left: rect.left, top: rect.top };
    const p = { x: (e.clientX - origin.left) / scale, y: (e.clientY - origin.top) / scale };
    const g: Gesture = {
      pointerId: e.pointerId,
      kind: 'ink',
      origin,
      points: [p.x, p.y, pressureOf(native)],
      hasPressure: e.pointerType === 'pen',
      predicted: [],
      dirty: null,
      needsDraw: true,
      lastSampleAt: performance.now(),
      holdAnchor: p,
      holdSince: Date.now(),
      snapped: false,
      erased: new Set(),
      lasso: [p],
      moveStart: p,
      offset: { x: 0, y: 0 },
      shape: null,
      pieces: new Map(),
      anchor: p,
      scaleFrom: p,
      factor: 1,
      startAngle: 0,
      angle: 0,
    };
    growDirty(g, p.x, p.y);

    if (handle === 'rotate' && selection) {
      const b = selection.bounds;
      g.kind = 'rotate';
      g.anchor = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      g.startAngle = Math.atan2(p.y - g.anchor.y, p.x - g.anchor.x);
      for (const id of selection.ids) hiddenRef.current.add(id);
      paintInk(true);
    } else if (handle && handle !== 'rotate' && selection) {
      const b = selection.bounds;
      const corners: Record<Corner, Point> = {
        nw: { x: b.x, y: b.y },
        ne: { x: b.x + b.width, y: b.y },
        se: { x: b.x + b.width, y: b.y + b.height },
        sw: { x: b.x, y: b.y + b.height },
      };
      const opposite: Record<Corner, Corner> = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' };
      g.kind = 'scale';
      g.anchor = corners[opposite[handle]];
      g.scaleFrom = corners[handle];
      for (const id of selection.ids) hiddenRef.current.add(id);
      paintInk(true);
    } else if (selection && rectContains(selection.bounds, p) && settings.tool !== 'eraser') {
      g.kind = 'move';
      for (const id of selection.ids) hiddenRef.current.add(id);
      paintInk(true);
    } else if (settings.tool === 'lasso') {
      setSelection(null);
      g.kind = 'lasso';
    } else {
      if (selection) setSelection(null);
      if (settings.tool === 'eraser') {
        g.kind = 'erase';
        eraseAt(g, p);
      }
    }
    gestureRef.current = g;
    requestRender();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (press && press.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
    const g = gestureRef.current;
    if (diagnostics.enabled && e.pointerType === 'pen') {
      const n = e.nativeEvent as PointerEvent & { altitudeAngle?: number; azimuthAngle?: number };
      if (e.buttons === 0) diagnostics.hover = 'yes';
      const deg = (r: number) => Math.round((r * 180) / Math.PI);
      diagnostics.tilt =
        n.altitudeAngle != null
          ? `altitude ${deg(n.altitudeAngle)}° azimuth ${deg(n.azimuthAngle ?? 0)}°`
          : `x ${e.tiltX} y ${e.tiltY}`;
      diagnostics.twist = e.twist;
    }
    if (!g && e.pointerType === 'pen' && e.buttons === 0) {
      onHover(e);
      return;
    }
    // Only contact counts for palm rejection; a hovering Pencil must not block finger scrolling.
    if (e.pointerType === 'pen' && e.buttons > 0) notePen();
    if (!g || g.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const native = e.nativeEvent;
    // Coalesced events carry every digitizer sample between frames — the key to precise ink.
    const samples = native.getCoalescedEvents?.() ?? [];
    const events = samples.length ? samples : [native];
    if (diagnostics.enabled) {
      recordEvent(events.length);
      diagnostics.pressure = Math.round(native.pressure * 100) / 100;
    }

    for (const ev of events) {
      const p = { x: (ev.clientX - g.origin.left) / scale, y: (ev.clientY - g.origin.top) / scale };
      switch (g.kind) {
        case 'ink':
          if (g.snapped) {
            if (g.shape) {
              const pts = adjustShape(g.shape.kind, g.shape.base, g.shape.from, p);
              const pr = g.shape.pressure;
              g.points = pts.flatMap((q) => [q.x, q.y, pr]);
              for (const q of pts) growDirty(g, q.x, q.y);
              g.needsDraw = true;
            }
            break;
          }
          g.points.push(p.x, p.y, pressureOf(ev));
          growDirty(g, p.x, p.y);
          if (Math.hypot(p.x - g.holdAnchor.x, p.y - g.holdAnchor.y) > 3) {
            g.holdAnchor = p;
            g.holdSince = Date.now();
          }
          break;
        case 'erase':
          eraseAt(g, p);
          break;
        case 'lasso':
          g.lasso.push(p);
          break;
        case 'move':
          g.offset = { x: p.x - g.moveStart.x, y: p.y - g.moveStart.y };
          break;
        case 'rotate': {
          let angle = Math.atan2(p.y - g.anchor.y, p.x - g.anchor.x) - g.startAngle;
          // Snap to straight angles (0°, 45°, 90°…) when close.
          const step = Math.PI / 4;
          const snapped = Math.round(angle / step) * step;
          if (Math.abs(angle - snapped) < (4 * Math.PI) / 180) angle = snapped;
          g.angle = angle;
          break;
        }
        case 'scale': {
          const from = Math.hypot(g.scaleFrom.x - g.anchor.x, g.scaleFrom.y - g.anchor.y);
          const to = Math.hypot(p.x - g.anchor.x, p.y - g.anchor.y);
          g.factor = Math.min(8, Math.max(0.1, from > 0 ? to / from : 1));
          break;
        }
      }
    }
    if (g.kind === 'ink' && g.snapped) {
      g.lastSampleAt = performance.now();
    } else if (g.kind === 'ink') {
      const predicted = native.getPredictedEvents?.() ?? [];
      g.predicted = predicted.flatMap((ev) => {
        const x = (ev.clientX - g.origin.left) / scale;
        const y = (ev.clientY - g.origin.top) / scale;
        growDirty(g, x, y);
        return [x, y, pressureOf(ev)];
      });
      g.needsDraw = true;
      g.lastSampleAt = performance.now();
    }
    requestRender();
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (pressRef.current?.id === e.pointerId) cancelPress();
    if (e.pointerType === 'pen') notePen(false);
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gestureRef.current = null;
    if (cancelled) diagnostics.cancels += 1;

    // A cancelled pen stroke (iPadOS occasionally cancels) is still kept: losing ink is worse.
    const keepInk = g.kind === 'ink' && g.points.length >= 3;
    if (!cancelled || keepInk) {
      switch (g.kind) {
        case 'ink': {
          if (g.points.length === 3) g.points.push(g.points[0]! + 0.1, g.points[1]! + 0.1, g.points[2]!); // a dot
          const stroke = { ...liveStroke(g, false), id: newId() };
          const ctx = inkRef.current?.getContext('2d');
          const region = regionRef.current;
          if (ctx && region) {
            applyRegion(ctx, region);
            drawStroke(ctx, stroke); // show immediately; the saved page won't need a repaint
            paintedRef.current.ids.add(stroke.id);
          }
          onChange(page.id, [stroke], []);
          // Like Drawboard: a recognised shape stays selected, ready to move, resize or rotate.
          if (g.snapped) setSelection({ ids: new Set([stroke.id]), bounds: strokeBounds(stroke) });
          break;
        }
        case 'erase':
          if (g.pieces.size) {
            onChange(page.id, [...g.pieces.values()].flat(), [...g.pieces.keys()]);
          } else if (g.erased.size) {
            onChange(page.id, [], [...g.erased]);
          }
          break;
        case 'rotate': {
          if (!selection) break;
          if (Math.abs(g.angle) < 0.005) {
            hiddenRef.current = new Set();
            paintInk(true);
            break;
          }
          const rotated = page.strokes
            .filter((s) => selection.ids.has(s.id))
            .map((s) => rotateStroke(s, g.anchor, g.angle, newId()));
          paintNow(rotated);
          onChange(page.id, rotated, [...selection.ids]);
          const bounds = unionRects(rotated.map(strokeBounds));
          if (bounds) setSelection({ ids: new Set(rotated.map((s) => s.id)), bounds });
          break;
        }
        case 'scale': {
          if (!selection) break;
          if (Math.abs(g.factor - 1) < 0.01) {
            hiddenRef.current = new Set();
            paintInk(true);
            break;
          }
          const f = g.factor;
          const scaled = page.strokes
            .filter((s) => selection.ids.has(s.id))
            .map((s) => scaleStroke(s, g.anchor, f, newId()));
          paintNow(scaled);
          onChange(page.id, scaled, [...selection.ids]);
          const b = selection.bounds;
          const x0 = g.anchor.x + (b.x - g.anchor.x) * f;
          const y0 = g.anchor.y + (b.y - g.anchor.y) * f;
          const x1 = g.anchor.x + (b.x + b.width - g.anchor.x) * f;
          const y1 = g.anchor.y + (b.y + b.height - g.anchor.y) * f;
          setSelection({
            ids: new Set(scaled.map((s) => s.id)),
            bounds: { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) },
          });
          break;
        }
        case 'lasso': {
          // A tap (no real loop) selects the ink under the tip.
          const loop = boundsOf(g.lasso);
          if (loop.width < 8 && loop.height < 8) {
            const hit = strokeAt(g.lasso[0]!);
            if (hit) selectStroke(hit);
            break;
          }
          const picked = page.strokes.filter((s) => strokeInLasso(s, g.lasso));
          const bounds = unionRects(picked.map(strokeBounds));
          if (picked.length && bounds) setSelection({ ids: new Set(picked.map((s) => s.id)), bounds });
          break;
        }
        case 'move': {
          if (!selection) break;
          const { x: dx, y: dy } = g.offset;
          if (Math.hypot(dx, dy) < 0.5) {
            hiddenRef.current = new Set();
            paintInk(true);
            break;
          }
          const moved = page.strokes
            .filter((s) => selection.ids.has(s.id))
            .map((s) => translateStroke(s, dx, dy, newId()));
          paintNow(moved);
          onChange(page.id, moved, [...selection.ids]);
          setSelection({
            ids: new Set(moved.map((s) => s.id)),
            bounds: { ...selection.bounds, x: selection.bounds.x + dx, y: selection.bounds.y + dy },
          });
          break;
        }
      }
    } else if (g.erased.size || g.pieces.size || g.kind === 'move' || g.kind === 'scale' || g.kind === 'rotate') {
      hiddenRef.current = new Set();
      paintInk(true);
    }
    requestRender(); // clears the live layer
  };

  const recolorSelection = (color: string) => {
    if (!selection) return;
    const recolored = page.strokes.filter((s) => selection.ids.has(s.id)).map((s) => recolorStroke(s, color, newId()));
    paintNow(recolored);
    onChange(page.id, recolored, [...selection.ids]);
    setSelection({ ...selection, ids: new Set(recolored.map((s) => s.id)) });
  };

  useEffect(() => {
    if (!selection) return;
    let tap: { id: number; x: number; y: number; t: number } | null = null;
    const isInside = (e: PointerEvent) => {
      const target = e.target as Element | null;
      // Selection menu/handles, the tool palette, the quick palette and dialogs never deselect.
      if (target?.closest?.('.selection-box, .tool-palette, .quick-palette, .modal-backdrop, .editor-top')) return true;
      const box = selectionBoxRef.current?.getBoundingClientRect();
      return !!box && e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
    };
    const onDown = (e: PointerEvent) => {
      if (isInside(e)) return;
      // A finger may be starting to scroll: only a tap deselects. Pencil/mouse deselect at once.
      if (e.pointerType === 'touch') tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
      else setSelection(null);
    };
    const onUp = (e: PointerEvent) => {
      if (tap && tap.id === e.pointerId && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 10 && performance.now() - tap.t < 400) {
        setSelection(null);
      }
      tap = null;
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
    };
  }, [selection]);

  const deleteSelection = () => {
    if (!selection) return;
    onChange(page.id, [], [...selection.ids]);
    setSelection(null);
  };

  const duplicateSelection = () => {
    if (!selection) return;
    const copies = page.strokes
      .filter((s) => selection.ids.has(s.id))
      .map((s) => translateStroke(s, 20, 20, newId()));
    onChange(page.id, copies, []);
    const b = boundsOf(copies.flatMap(strokePoints));
    setSelection({
      ids: new Set(copies.map((s) => s.id)),
      bounds: { ...b, x: b.x - 4, y: b.y - 4, width: b.width + 8, height: b.height + 8 },
    });
  };

  return (
    <div
      ref={containerRef}
      className="ink-page"
      style={{ width: cssWidth, height: cssHeight, ...templateStyle(page.template, scale) }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onPointerLeave={endHover}
      onContextMenu={(e) => e.preventDefault()}
    >
      {background && <canvas ref={pdfCanvasRef} className="ink-layer pdf-layer" width={0} height={0} />}
      {background && pdfMissing && <div className="pdf-missing">PDF is still downloading from Google Drive…</div>}
      <canvas ref={inkRef} className="ink-layer" width={0} height={0} />
      <canvas ref={liveRef} className="ink-layer ink-input" width={0} height={0} />
      {selection && (
        <div
          ref={selectionBoxRef}
          className="selection-box"
          style={{
            left: selection.bounds.x * scale,
            top: selection.bounds.y * scale,
            width: selection.bounds.width * scale,
            height: selection.bounds.height * scale,
          }}
        >
          <div ref={menuRef} className="selection-menu">
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                className="selection-color"
                style={{ background: c }}
                aria-label={`Recolor ${c}`}
                onClick={() => recolorSelection(c)}
              />
            ))}
            <button onClick={duplicateSelection}>Duplicate</button>
            <button onClick={deleteSelection}>Delete</button>
          </div>
          {(['nw', 'ne', 'se', 'sw'] as const).map((corner) => (
            <div key={corner} className={`selection-handle ${corner}`} data-handle={corner} aria-label="Resize" />
          ))}
          <div className="selection-rotate" data-handle="rotate" aria-label="Rotate">
            ↻
          </div>
        </div>
      )}
    </div>
  );
}
