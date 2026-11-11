import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { newId, type Page, type Stroke } from '../model/types';
import { applyRegion, DEFAULT_FILL_OPACITY, drawPage, drawStroke, type CanvasRegion } from './render';
import { adjustShape, polylinePoints, recognizeShape, type ShapeKind } from './shapes';
import { buildGuides, sameSnap, snapLineEnd, snapToPoint, type SnapGuides, type SnapResult } from './snapping';
import { pencilHaptic } from '../pencil/haptics';
import { makeImageStroke, onImageLoaded, readDropped, resolveDropped, storeImage } from './images';
import { arrange, type ArrangeAction } from './layers';
import { getClip, inkForPaste, onClipChange, setClip } from './clipboard';
import { Slider } from './Slider';
import { dragVertex, shapeVertices, strokeThrough, type ShapeVertices } from './shapeEdit';
import {
  boundsOf,
  rectContains,
  strokeBounds,
  strokeHit,
  strokeInLasso,
  strokePoints,
  translateStroke,
  scaleStrokeXY,
  recolorStroke,
  fillStroke,
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
import { noteHover, notePen, penActiveWithin } from './penState';
import { diagnostics, recordEvent, recordFrame } from './diagnostics';
import { hideHoverCursor, showHoverCursor } from './hoverCursor';

export type ToolKind = 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'laser';

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
  kind: 'ink' | 'erase' | 'lasso' | 'move' | 'scale' | 'rotate' | 'laser' | 'vertex';
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
  /** Resizing a selection: fixed point, the dragged handle's start, stretch per axis. */
  anchor: Point;
  scaleFrom: Point;
  sx: number;
  sy: number;
  /** Which directions a resize handle stretches (corners: both; side handles: one). */
  axis: { x: boolean; y: boolean };
  /** Dragging one point of a shape (line end, rectangle corner, polygon corner). */
  vertex: { index: number; shape: ShapeVertices; stroke: Stroke; current: Point[] } | null;
  /** Rotating a selection: pointer angle at start and current rotation (radians). */
  startAngle: number;
  angle: number;
  /** Snapped shape that keeps following the Pencil until it lifts (Drawboard-style). */
  shape: { kind: ShapeKind; base: Point[]; from: Point; pressure: number } | null;
  /** When the gesture started (performance.now), to tell a tap from a stroke. */
  startedAt: number;
  /** Straight ink on the page a snapped line can snap to (built once, when the line snaps). */
  guides: SnapGuides | null;
  /** What the snapped line is currently snapped to, shown as a guide. */
  snap: SnapResult | null;
}

interface Selection {
  ids: Set<string>;
  bounds: Rect;
}

const HOLD_TO_SNAP_MS = 500;
/** A finger touch shorter than this (that didn't move) is a tap: on ink it selects it, like Drawboard. */
const TAP_MS = 300;
type Corner = 'nw' | 'ne' | 'se' | 'sw';
type Side = 'n' | 'e' | 's' | 'w';
type Handle = Corner | Side | 'rotate' | `v${number}`;
/** Rotation snaps to every 15° when within this many degrees. */
const ROTATE_SNAP_DEG = 3;
const LONG_PRESS_MS = 480;

const HOVER_HOLD_MS = 900;
/** Laser pointer trail: how long each bit stays visible (ms). Never saved. */
const LASER_LIFE_MS = 900;
/** Extra area rendered around the visible part, so small scrolls need no redraw. */
const VIEW_MARGIN = 0.3;
/** Of the 2 × VIEW_MARGIN screens of extra canvas, this much goes ahead of the scrolling. */
const VIEW_MARGIN_AHEAD = 0.48;
/** iPad Safari refuses canvases above ~16.7M pixels; stay well under per canvas. */
const MAX_CANVAS_PIXELS = 10_000_000;

/** Menus, buttons and sliders on the page (the Pencil and fingers operate them, not write). */
export function isControl(target: EventTarget | null): boolean {
  return !!(target as Element | null)?.closest?.('button, input, select, textarea, label, [role="slider"], .selection-menu, .canvas-menu');
}

/** Swaps replaced items' ids in a selection (recolour / fill make new strokes). */
function replaceIds(ids: Set<string>, before: Stroke[], after: Stroke[]): Set<string> {
  const next = new Set(ids);
  before.forEach((s, i) => {
    next.delete(s.id);
    next.add(after[i]!.id);
  });
  return next;
}

/** Editor → page requests (the page currently on screen handles them). */
export const PAGE_ACTION = 'noteboard-page-action';
/** Editor → pages: recompute the visible area now (after a zoom's scroll jump). */
export const RELAYOUT = 'noteboard-relayout';
export type PageAction = { pageId: string; action: 'insertPictures' | 'paste'; files: Blob[] };

function getLiveContext(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  // Plain context on purpose: the low-latency 'desynchronized' mode changes how Safari composites
  // the page and is a suspect for the hover pointer's ghost copy.
  return canvas?.getContext('2d') ?? null;
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
  /** Laser pointer trails (page units + time), fading out; one array per touch. */
  const laserRef = useRef<{ x: number; y: number; t: number }[][]>([]);
  const hiddenRef = useRef<Set<string>>(new Set());
  const frameRef = useRef<number | null>(null);
  const hoverRef = useRef<{ x: number; y: number; timer: number | null } | null>(null);
  const pressRef = useRef<{ id: number; x: number; y: number; at: Point; t: number; timer: number } | null>(null);
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
  const lastScrollTop = useRef(0);
  const scrollDirection = useRef(0);
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
      // Extra canvas ahead of where the page is scrolling, less behind (same total size).
      const scrollTop = scroller.scrollTop;
      const direction = Math.sign(scrollTop - lastScrollTop.current);
      if (direction) scrollDirection.current = direction;
      lastScrollTop.current = scrollTop;
      const ahead = sr.height * VIEW_MARGIN_AHEAD;
      const behind = sr.height * (VIEW_MARGIN * 2 - VIEW_MARGIN_AHEAD);
      const above = scrollDirection.current < 0 ? ahead : scrollDirection.current > 0 ? behind : sr.height * VIEW_MARGIN;
      const below = scrollDirection.current > 0 ? ahead : scrollDirection.current < 0 ? behind : sr.height * VIEW_MARGIN;
      const left = Math.max(pr.left, sr.left - mx);
      const right = Math.min(pr.right, sr.right + mx);
      const top = Math.max(pr.top, sr.top - above);
      const bottom = Math.min(pr.bottom, sr.bottom + below);

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
    const relayout = () => layout(true);
    window.addEventListener(RELAYOUT, relayout);
    const observer = new ResizeObserver(() => layout());
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener(RELAYOUT, relayout);
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

  /** Draws the fading laser trails; returns true while anything is still visible. */
  const drawLaser = (ctx: CanvasRenderingContext2D, region: CanvasRegion): boolean => {
    const now = performance.now();
    const drawing = gestureRef.current?.kind === 'laser';
    // Drop faded points (the trail being drawn keeps at least its tip).
    laserRef.current = laserRef.current
      .map((trail, i, all) => {
        const live = drawing && i === all.length - 1;
        const kept = trail.filter((q) => now - q.t < LASER_LIFE_MS);
        return live && !kept.length && trail.length ? [trail[trail.length - 1]!] : kept;
      })
      .filter((trail) => trail.length);
    clearLive(ctx, null);
    if (!laserRef.current.length) return false;
    applyRegion(ctx, region);
    const px = 1 / scale;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const trail of laserRef.current) {
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1]!;
        const b = trail[i]!;
        const fade = Math.max(0, 1 - (now - b.t) / LASER_LIFE_MS);
        // Soft red glow, then a bright core.
        ctx.globalAlpha = 0.25 * fade;
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = 12 * px;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.globalAlpha = fade;
        ctx.strokeStyle = '#ff6b5e';
        ctx.lineWidth = 4 * px;
        ctx.stroke();
      }
      const tip = trail[trail.length - 1]!;
      const fade = Math.max(0, 1 - (now - tip.t) / LASER_LIFE_MS);
      ctx.globalAlpha = drawing ? 1 : fade;
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 5 * px, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return true;
  };

  // ---- Shape points, size / angle readout ---------------------------------------------------
  /** A single selected straight-edged shape is edited by its points (line: 2, rectangle: 4…). */
  const editShape = useMemo(() => {
    if (!selection || selection.ids.size !== 1) return null;
    const stroke = page.strokes.find((s) => selection.ids.has(s.id));
    const shape = stroke ? shapeVertices(stroke) : null;
    return stroke && shape ? { stroke, shape } : null;
  }, [selection, page.strokes]);

  /** Moves the point handles during a drag (no React re-render per frame). */
  const placeVertexHandles = (vertices: Point[]) => {
    const box = selectionBoxRef.current;
    if (!box || !selection) return;
    vertices.forEach((q, i) => {
      const el = box.querySelector<HTMLElement>(`[data-handle="v${i}"]`);
      if (!el) return;
      el.style.left = `${(q.x - selection.bounds.x) * scale}px`;
      el.style.top = `${(q.y - selection.bounds.y) * scale}px`;
    });
  };

  /** Tapping or dragging on the selection (generous area, so a thin line is easy to grab). */
  const onSelectionBody = (p: Point) => {
    if (!selection) return false;
    const pad = 12 / scale;
    const b = selection.bounds;
    const inBox = p.x >= b.x - pad && p.x <= b.x + b.width + pad && p.y >= b.y - pad && p.y <= b.y + b.height + pad;
    if (!inBox) return false;
    if (!editShape || editShape.shape.closed) return true;
    // A line: only near the line itself, not the whole empty box around a diagonal.
    return strokeHit(editShape.stroke, p, pad);
  };

  const badgeRef = useRef<HTMLDivElement>(null);
  const showBadge = (text: string) => {
    const el = badgeRef.current;
    const box = selectionBoxRef.current?.getBoundingClientRect();
    const page = containerRef.current?.getBoundingClientRect();
    if (!el || !box || !page) return;
    el.textContent = text;
    el.style.display = 'block';
    el.style.left = `${box.left + box.width / 2 - page.left}px`;
    el.style.top = `${box.top + box.height / 2 - page.top - 14}px`;
  };
  const hideBadge = () => {
    if (badgeRef.current) badgeRef.current.style.display = 'none';
  };

  /** How close (page units) the Pencil must come to a point for it to snap: ~12 screen px. */
  const snapRadius = () => Math.max(4, 12 / scale);

  /** Makes the live stroke a straight line a→b. */
  const setLine = (g: Gesture, a: Point, b: Point) => {
    const pr = g.shape?.pressure ?? 0.5;
    const pts = polylinePoints([a, b], false);
    g.points = pts.flatMap((q) => [q.x, q.y, pr]);
    for (const q of pts) growDirty(g, q.x, q.y);
    g.needsDraw = true;
  };

  /** Shows what a snapped line is aligned to (Drawboard-style guide). */
  const drawSnapGuide = (ctx: CanvasRenderingContext2D, g: Gesture) => {
    const snap = g.snap;
    if (!snap) return;
    const px = 1 / scale;
    ctx.save();
    ctx.strokeStyle = '#2f6fde';
    ctx.fillStyle = '#2f6fde';
    ctx.lineWidth = 1.5 * px;
    if (snap.kind === 'end' || snap.kind === 'mid') {
      ctx.beginPath();
      ctx.arc(snap.point.x, snap.point.y, 6 * px, 0, Math.PI * 2);
      ctx.stroke();
      if (snap.kind === 'mid') {
        ctx.font = `${11 * px}px -apple-system, system-ui, sans-serif`;
        ctx.fillText('midpoint', snap.point.x + 9 * px, snap.point.y - 9 * px);
      }
    } else {
      const a = g.shape?.base[0];
      if (a) {
        // Dashed guide along the snapped direction, across the page.
        const dx = snap.point.x - a.x;
        const dy = snap.point.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const far = 2000;
        ctx.setLineDash([6 * px, 5 * px]);
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(a.x - (dx / len) * far, a.y - (dy / len) * far);
        ctx.lineTo(a.x + (dx / len) * far, a.y + (dy / len) * far);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      if (snap.segment) {
        ctx.lineWidth = 3 * px;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.moveTo(snap.segment.a.x, snap.segment.a.y);
        ctx.lineTo(snap.segment.b.x, snap.segment.b.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const label =
        snap.kind === 'perpendicular' ? '⊥ 90°' : snap.kind === 'parallel' ? '∥ parallel' : `${Math.round(((snap.degrees ?? 0) % 180 + 180) % 180)}°`;
      ctx.font = `${11 * px}px -apple-system, system-ui, sans-serif`;
      ctx.fillText(label, snap.point.x + 9 * px, snap.point.y - 9 * px);
    }
    ctx.restore();
  };

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
    if (laserRef.current.length) {
      if (drawLaser(ctx, region)) requestRender();
      if (!g || g.kind === 'laser') return;
    }
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
          if (shape.kind === 'line') {
            g.guides = buildGuides(page.strokes);
            // Start the line exactly on a nearby end / midpoint, so lines connect.
            const start = snapToPoint(shape.points[0]!, g.guides, snapRadius());
            const a = start?.point ?? shape.points[0]!;
            const end = shape.points[shape.points.length - 1]!;
            g.shape.base = [a, end];
            setLine(g, a, end);
          }
          pencilHaptic('pathCompleted', g.origin.left + pts[pts.length - 1]!.x * scale, g.origin.top + pts[pts.length - 1]!.y * scale);
          g.needsDraw = true;
        } else {
          g.holdSince = Infinity; // don't retry on every frame
        }
      }
      if (g.needsDraw) {
        const start = performance.now();
        clearLive(ctx, g.guides ? null : g.dirty);
        applyRegion(ctx, region);
        if (g.snap) drawSnapGuide(ctx, g);
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
      ctx.scale(g.sx, g.sy);
      ctx.translate(-g.anchor.x, -g.anchor.y);
      for (const s of page.strokes) if (selection.ids.has(s.id)) drawStroke(ctx, s);
      const b = selection.bounds;
      setBoxTransform(`scale(${g.sx}, ${g.sy})`, `${(g.anchor.x - b.x) * scale}px ${(g.anchor.y - b.y) * scale}px`);
      showBadge(`${Math.round(b.width * g.sx)} × ${Math.round(b.height * g.sy)}`);
    } else if (g.kind === 'rotate' && selection) {
      ctx.translate(g.anchor.x, g.anchor.y);
      ctx.rotate(g.angle);
      ctx.translate(-g.anchor.x, -g.anchor.y);
      for (const s of page.strokes) if (selection.ids.has(s.id)) drawStroke(ctx, s);
      setBoxTransform(`rotate(${g.angle}rad)`, '50% 50%');
      // Angle readout, like Drawboard: -180° … 180°.
      let deg = Math.round((g.angle * 180) / Math.PI) % 360;
      if (deg > 180) deg -= 360;
      if (deg <= -180) deg += 360;
      showBadge(`${deg}°`);
    } else if (g.kind === 'vertex' && g.vertex) {
      const v = g.vertex;
      drawStroke(ctx, strokeThrough(v.stroke, v.current, v.shape.closed, v.stroke.id));
      if (g.snap) {
        g.shape = { kind: 'line', base: [v.shape.vertices[1 - v.index]!], from: { x: 0, y: 0 }, pressure: 0.5 };
        drawSnapGuide(ctx, g);
        g.shape = null;
      }
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
    // The menu hides while the selection is being moved, resized or rotated.
    box.classList.toggle('transforming', !!transform);
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
        if (s.tool === 'image') continue;
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
      if (s.tool === 'image') continue;
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
    noteHover();
    const tool = settings.tool;
    // Preview exactly where (and how big) ink will land.
    const size =
      tool === 'laser'
        ? 10
        : tool === 'eraser'
        ? settings.eraserSize * scale
        : tool === 'highlighter'
          ? settings.highlighterSize * scale
          : Math.max(5, settings.penSize * scale);
    if (tool === 'eraser' || settings.hoverPreview !== false) {
      showHoverCursor(e.clientX, e.clientY, {
        tool,
        size,
        color: tool === 'highlighter' ? settings.highlighterColor : settings.color,
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
    if (isControl(e.target)) return; // menus, buttons, sliders: not writing
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
      // Tap ink with a finger to select it (like Drawboard), or long-press it (like Apple Notes).
      cancelPress();
      if (!onRequestSelect) return;
      pressRef.current = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        at,
        t: performance.now(),
        timer: window.setTimeout(() => {
          pressRef.current = null;
          const hit = strokeAt(at);
          if (!hit) {
            setCanvasMenu(at);
            return;
          }
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
      sx: 1,
      sy: 1,
      axis: { x: true, y: true },
      vertex: null,
      startAngle: 0,
      angle: 0,
      startedAt: performance.now(),
      guides: null,
      snap: null,
    };
    growDirty(g, p.x, p.y);

    if (handle === 'rotate' && selection) {
      const b = selection.bounds;
      g.kind = 'rotate';
      g.anchor = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      g.startAngle = Math.atan2(p.y - g.anchor.y, p.x - g.anchor.x);
      for (const id of selection.ids) hiddenRef.current.add(id);
      paintInk(true);
    } else if (handle?.startsWith('v') && selection && editShape) {
      // Drag one point of the shape.
      g.kind = 'vertex';
      g.vertex = { index: Number(handle.slice(1)), shape: editShape.shape, stroke: editShape.stroke, current: editShape.shape.vertices };
      g.guides = buildGuides(page.strokes, selection.ids);
      hiddenRef.current.add(editShape.stroke.id);
      paintInk(true);
    } else if (handle && handle !== 'rotate' && selection) {
      const b = selection.bounds;
      const x0 = b.x;
      const x1 = b.x + b.width;
      const y0 = b.y;
      const y1 = b.y + b.height;
      const xm = b.x + b.width / 2;
      const ym = b.y + b.height / 2;
      // [dragged point, fixed point, stretches x, stretches y]
      const spec: Record<Corner | Side, [Point, Point, boolean, boolean]> = {
        nw: [{ x: x0, y: y0 }, { x: x1, y: y1 }, true, true],
        ne: [{ x: x1, y: y0 }, { x: x0, y: y1 }, true, true],
        se: [{ x: x1, y: y1 }, { x: x0, y: y0 }, true, true],
        sw: [{ x: x0, y: y1 }, { x: x1, y: y0 }, true, true],
        n: [{ x: xm, y: y0 }, { x: xm, y: y1 }, false, true],
        s: [{ x: xm, y: y1 }, { x: xm, y: y0 }, false, true],
        e: [{ x: x1, y: ym }, { x: x0, y: ym }, true, false],
        w: [{ x: x0, y: ym }, { x: x1, y: ym }, true, false],
      };
      const [from, anchor, ax, ay] = spec[handle as Corner | Side];
      g.kind = 'scale';
      g.anchor = anchor;
      g.scaleFrom = from;
      g.axis = { x: ax, y: ay };
      for (const id of selection.ids) hiddenRef.current.add(id);
      paintInk(true);
    } else if (selection && settings.tool !== 'eraser' && onSelectionBody(p)) {
      g.kind = 'move';
      for (const id of selection.ids) hiddenRef.current.add(id);
      paintInk(true);
    } else if (settings.tool === 'laser') {
      g.kind = 'laser';
      laserRef.current.push([{ ...p, t: performance.now() }]);
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
      // Over a menu the Pencil is pointing at controls: no ink cursor, no hover palette.
      if (isControl(e.target)) endHover();
      else onHover(e);
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
            if (g.shape?.kind === 'line') {
              const a = g.shape.base[0]!;
              const snap = g.guides ? snapLineEnd(a, p, g.guides, snapRadius()) : null;
              if (snap && !sameSnap(snap, g.snap)) {
                pencilHaptic('alignment', g.origin.left + snap.point.x * scale, g.origin.top + snap.point.y * scale);
              }
              g.snap = snap;
              setLine(g, a, snap?.point ?? p);
            } else if (g.shape) {
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
        case 'laser':
          laserRef.current[laserRef.current.length - 1]?.push({ ...p, t: performance.now() });
          break;
        case 'move':
          g.offset = { x: p.x - g.moveStart.x, y: p.y - g.moveStart.y };
          break;
        case 'rotate': {
          let angle = Math.atan2(p.y - g.anchor.y, p.x - g.anchor.x) - g.startAngle;
          // Snap to every 15° (0°, 15°, 30°, 45°, 90°…) when close, with a Pencil tick.
          const step = Math.PI / 12;
          const snapped = Math.round(angle / step) * step;
          const isSnapped = Math.abs(angle - snapped) < (ROTATE_SNAP_DEG * Math.PI) / 180;
          if (isSnapped) {
            if (Math.abs(snapped - g.angle) > 1e-6) pencilHaptic('alignment', ev.clientX, ev.clientY);
            angle = snapped;
          }
          g.angle = angle;
          break;
        }
        case 'scale': {
          // Free resize: width and height stretch separately (corners), or one of them (sides).
          const stretch = (from: number, anchor: number, to: number) => {
            const d0 = from - anchor;
            if (Math.abs(d0) < 2) return 1; // a flat line has no height to stretch
            return Math.min(20, Math.max(0.05, (to - anchor) / d0));
          };
          g.sx = g.axis.x ? stretch(g.scaleFrom.x, g.anchor.x, p.x) : 1;
          g.sy = g.axis.y ? stretch(g.scaleFrom.y, g.anchor.y, p.y) : 1;
          break;
        }
        case 'vertex': {
          const v = g.vertex;
          if (!v) break;
          let to = p;
          if (v.shape.vertices.length === 2 && !v.shape.closed && g.guides) {
            // A line's end snaps like when drawing it (ends, midpoints, perpendicular, angles).
            const fixed = v.shape.vertices[1 - v.index]!;
            const snap = snapLineEnd(fixed, p, g.guides, snapRadius());
            if (snap && !sameSnap(snap, g.snap)) pencilHaptic('alignment', ev.clientX, ev.clientY);
            g.snap = snap;
            to = snap?.point ?? p;
          }
          v.current = dragVertex(v.shape, v.index, to);
          placeVertexHandles(v.current);
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
    const press = pressRef.current;
    if (press?.id === e.pointerId) {
      cancelPress();
      // A quick finger tap that didn't move (moving cancels the press): select the ink under it.
      if (!cancelled && performance.now() - press.t < TAP_MS) {
        const hit = strokeAt(press.at);
        if (hit) selectStroke(hit);
      }
    }
    if (e.pointerType === 'pen') notePen(false);
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gestureRef.current = null;
    if (cancelled) diagnostics.cancels += 1;
    hideBadge();

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
        case 'vertex': {
          const v = g.vertex;
          if (!v || !selection) break;
          const moved = v.current.some((q, i) => Math.hypot(q.x - v.shape.vertices[i]!.x, q.y - v.shape.vertices[i]!.y) > 0.3);
          if (!moved) {
            hiddenRef.current = new Set();
            paintInk(true);
            placeVertexHandles(v.shape.vertices);
            break;
          }
          const edited = strokeThrough(v.stroke, v.current, v.shape.closed, newId());
          paintNow([edited]);
          onChange(page.id, [edited], [v.stroke.id]);
          setSelection({ ids: new Set([edited.id]), bounds: strokeBounds(edited) });
          break;
        }
        case 'scale': {
          if (!selection) break;
          if (Math.abs(g.sx - 1) < 0.005 && Math.abs(g.sy - 1) < 0.005) {
            hiddenRef.current = new Set();
            paintInk(true);
            break;
          }
          const { sx, sy } = g;
          const scaled = page.strokes
            .filter((s) => selection.ids.has(s.id))
            .map((s) => scaleStrokeXY(s, g.anchor, sx, sy, newId()));
          paintNow(scaled);
          onChange(page.id, scaled, [...selection.ids]);
          const b = selection.bounds;
          const x0 = g.anchor.x + (b.x - g.anchor.x) * sx;
          const y0 = g.anchor.y + (b.y - g.anchor.y) * sy;
          const x1 = g.anchor.x + (b.x + b.width - g.anchor.x) * sx;
          const y1 = g.anchor.y + (b.y + b.height - g.anchor.y) * sy;
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
    } else if (g.erased.size || g.pieces.size || g.kind === 'move' || g.kind === 'scale' || g.kind === 'rotate' || g.kind === 'vertex') {
      hiddenRef.current = new Set();
      paintInk(true);
    }
    requestRender(); // clears the live layer
  };

  const recolorSelection = (color: string) => {
    if (!selection) return;
    const targets = page.strokes.filter((s) => selection.ids.has(s.id) && s.tool !== 'image');
    if (!targets.length) return;
    const recolored = targets.map((s) => recolorStroke(s, color, newId()));
    paintNow(recolored);
    onChange(page.id, recolored, targets.map((s) => s.id));
    keepPanelRef.current = true;
    setSelection({ ...selection, ids: replaceIds(selection.ids, targets, recolored) });
  };

  /** Fills the selected strokes (null = remove fill). */
  const fillSelection = (fill: string | null, opacity: number) => {
    if (!selection) return;
    const targets = page.strokes.filter((s) => selection.ids.has(s.id) && s.tool !== 'image');
    if (!targets.length) return;
    const filled = targets.map((s) => fillStroke(s, fill, opacity, newId()));
    paintNow(filled);
    onChange(page.id, filled, targets.map((s) => s.id));
    keepPanelRef.current = true;
    setSelection({ ...selection, ids: replaceIds(selection.ids, targets, filled) });
  };
  const selectedFill = selection ? page.strokes.find((s) => selection.ids.has(s.id) && s.fill) : undefined;

  /** Shows the selection with a different fill opacity while the slider moves (not saved yet). */
  const previewFill = (opacity: number) => {
    if (!selection || !selectedFill?.fill) return;
    const targets = page.strokes.filter((s) => selection.ids.has(s.id) && s.tool !== 'image');
    hiddenRef.current = new Set(targets.map((s) => s.id));
    paintInk(true);
    const ctx = inkRef.current?.getContext('2d');
    const region = regionRef.current;
    if (!ctx || !region) return;
    applyRegion(ctx, region);
    for (const s of targets) drawStroke(ctx, s.fill ? fillStroke(s, s.fill, opacity, s.id) : s);
  };
  const endPreview = () => {
    if (!hiddenRef.current.size) return;
    hiddenRef.current = new Set();
    paintInk(true);
  };
  const [fillOpacity, setFillOpacity] = useState(DEFAULT_FILL_OPACITY);
  /** Which pop-up of the selection menu is open. */
  const [menuPanel, setMenuPanel] = useState<'color' | 'fill' | 'arrange' | null>(null);
  const onlyPictures = !!selection && page.strokes.every((s) => !selection.ids.has(s.id) || s.tool === 'image');
  const selectedColor = (selection && page.strokes.find((s) => selection.ids.has(s.id))?.color) || settings.color;
  // A new selection starts with the pop-ups closed and the slider showing its current fill.
  const selectionKey = selection ? [...selection.ids].join() : '';
  /** Set when the menu itself changed the selection (recolour, fill, arrange): keep its pop-up open. */
  const keepPanelRef = useRef(false);
  useEffect(() => {
    if (keepPanelRef.current) {
      keepPanelRef.current = false;
      return;
    }
    setMenuPanel(null);
  }, [selectionKey]);
  useEffect(() => {
    if (selectedFill?.fillOpacity != null) setFillOpacity(selectedFill.fillOpacity);
  }, [selectedFill?.fillOpacity]);

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

  // ---- Copy / cut / paste, layering, pictures ------------------------------------------------
  const [canvasMenu, setCanvasMenu] = useState<Point | null>(null);
  const [clipKind, setClipKind] = useState(() => getClip()?.kind ?? null);
  useEffect(() => onClipChange(() => setClipKind(getClip()?.kind ?? null)), []);
  const imageInputRef = useRef<HTMLInputElement>(null);
  /** Where "Insert picture…" from the canvas menu puts the picture. */
  const insertAtRef = useRef<Point | null>(null);

  // Pictures decode in the background; repaint when one arrives.
  useEffect(() => onImageLoaded(() => paintInk(true)), [paintInk]);

  const selectedStrokes = () => (selection ? page.strokes.filter((s) => selection.ids.has(s.id)) : []);

  const selectAll = (strokes: Stroke[]) => {
    const bounds = unionRects(strokes.map(strokeBounds));
    if (strokes.length && bounds) setSelection({ ids: new Set(strokes.map((s) => s.id)), bounds });
  };

  const copySelection = () => {
    const strokes = selectedStrokes();
    if (strokes.length) setClip({ kind: 'ink', strokes });
    setMenuPanel(null);
  };

  const cutSelection = () => {
    copySelection();
    deleteSelection();
  };

  /** Pastes Noteboard's clipboard ink at a point (page units), or next to where it was copied. */
  const pasteInk = (at: Point | null) => {
    const clip = getClip();
    if (clip?.kind !== 'ink') return false;
    const copies = inkForPaste(clip.strokes, at);
    if (!copies.length) return false;
    paintNow(copies);
    onChange(page.id, copies, []);
    selectAll(copies);
    return true;
  };

  /** The middle of the part of this page that's on screen. */
  const visibleCenter = (): Point => {
    const box = containerRef.current?.getBoundingClientRect();
    const view = (scroller ?? document.documentElement).getBoundingClientRect();
    if (!box) return { x: page.width / 2, y: page.height / 2 };
    const top = Math.max(box.top, view.top);
    const bottom = Math.min(box.bottom, view.bottom);
    const left = Math.max(box.left, view.left);
    const right = Math.min(box.right, view.right);
    return {
      x: Math.min(page.width, Math.max(0, ((left + right) / 2 - box.left) / scale)),
      y: Math.min(page.height, Math.max(0, ((top + bottom) / 2 - box.top) / scale)),
    };
  };

  /** Places pictures on the page (stored on this device and synced like PDFs). */
  const insertPictures = async (files: Blob[], at: Point | null) => {
    const center = at ?? visibleCenter();
    const added: Stroke[] = [];
    for (const [i, file] of files.entries()) {
      try {
        const { fileId, width, height } = await storeImage(file, (file as File).name || 'Picture');
        const pos = { x: center.x + i * 24, y: center.y + i * 24 };
        added.push({ ...makeImageStroke(fileId, width, height, pos, page.width * 0.7, page.height * 0.5), createdAt: Date.now() + i });
      } catch {
        alert('This picture could not be added.');
      }
    }
    if (!added.length) return;
    paintNow(added);
    onChange(page.id, added, []);
    selectAll(added);
  };

  /** Paste from the system clipboard (pictures copied in Photos, Safari…). */
  const pasteFromSystem = async (at: Point | null) => {
    try {
      const items = await navigator.clipboard.read();
      const blobs: Blob[] = [];
      for (const item of items) {
        const type = item.types.find((ty) => ty.startsWith('image/'));
        if (type) blobs.push(await item.getType(type));
      }
      if (blobs.length) {
        await insertPictures(blobs, at);
        return true;
      }
    } catch {
      // Not allowed or nothing there.
    }
    return false;
  };

  const paste = async (at: Point | null) => {
    setCanvasMenu(null);
    if (pasteInk(at)) return;
    if (!(await pasteFromSystem(at))) alert('There is nothing to paste. Copy some ink or a picture first.');
  };

  const arrangeSelection = (action: ArrangeAction) => {
    if (!selection) return;
    const result = arrange(page.strokes, selection.ids, action);
    if (!result) return;
    onChange(page.id, result.added, result.removedIds);
    keepPanelRef.current = true;
    setSelection({ ...selection, ids: new Set(result.added.map((s) => s.id)) });
  };

  // Requests from the editor (toolbar "Picture" button, keyboard paste) for the page on screen.
  useEffect(() => {
    const onAction = (e: Event) => {
      const detail = (e as CustomEvent<PageAction>).detail;
      if (detail.pageId !== page.id) return;
      if (detail.action === 'insertPictures') void insertPictures(detail.files, null);
      else if (detail.action === 'paste') {
        if (detail.files.length) void insertPictures(detail.files, null);
        else if (!pasteInk(visibleCenter())) void pasteFromSystem(visibleCenter());
      }
    };
    window.addEventListener(PAGE_ACTION, onAction);
    return () => window.removeEventListener(PAGE_ACTION, onAction);
  });

  // The canvas menu closes on any touch elsewhere.
  useEffect(() => {
    if (!canvasMenu) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.('.canvas-menu')) setCanvasMenu(null);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [canvasMenu]);

  const deleteSelection = () => {
    if (!selection) return;
    onChange(page.id, [], [...selection.ids]);
    setSelection(null);
  };

  const duplicateSelection = () => {
    if (!selection) return;
    const copies = page.strokes
      .filter((s) => selection.ids.has(s.id))
      .map((s, i) => ({ ...translateStroke(s, 20, 20, newId()), createdAt: Date.now() + i / 1000 }));
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
      // Accept every drag: while dragging, Safari hides what's being dragged, so we can only
      // check for pictures when it's dropped.
      onDragEnter={(e) => e.preventDefault()}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const dropped = readDropped(e.dataTransfer); // read now: the data is gone after this event
        const box = containerRef.current!.getBoundingClientRect();
        const at = { x: (e.clientX - box.left) / scale, y: (e.clientY - box.top) / scale };
        void resolveDropped(dropped).then((blobs) => {
          if (blobs.length) void insertPictures(blobs, at);
          else if (dropped.files.length || dropped.urls.length) alert('This picture could not be added. Try saving it to Photos first, then drag it from there.');
        });
      }}
    >
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) void insertPictures(files, insertAtRef.current);
        }}
      />
      {canvasMenu && (
        <div
          className="canvas-menu"
          role="menu"
          style={{ left: canvasMenu.x * scale, top: canvasMenu.y * scale }}
        >
          <button role="menuitem" onClick={() => void paste(canvasMenu)}>
            Paste{clipKind === 'ink' ? '' : ' picture'}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              insertAtRef.current = canvasMenu;
              setCanvasMenu(null);
              imageInputRef.current?.click();
            }}
          >
            Insert picture…
          </button>
        </div>
      )}
      {background && <canvas ref={pdfCanvasRef} className="ink-layer pdf-layer" width={0} height={0} />}
      {background && pdfMissing && <div className="pdf-missing">PDF is still downloading from Google Drive…</div>}
      <canvas ref={inkRef} className="ink-layer" width={0} height={0} />
      <canvas ref={liveRef} className="ink-layer ink-input" width={0} height={0} />
      {selection && (
        <div
          ref={selectionBoxRef}
          className={`selection-box${editShape && !editShape.shape.closed ? ' line-mode' : ''}`}
          style={{
            left: selection.bounds.x * scale,
            top: selection.bounds.y * scale,
            width: selection.bounds.width * scale,
            height: selection.bounds.height * scale,
          }}
        >
          <div ref={menuRef} className="selection-menu" role="toolbar" aria-label="Selection">
            {!onlyPictures && (
            <button
              className={`sel-btn${menuPanel === 'color' ? ' open' : ''}`}
              aria-label="Colour"
              aria-expanded={menuPanel === 'color'}
              onClick={() => setMenuPanel((p) => (p === 'color' ? null : 'color'))}
            >
              <span className="sel-swatch" style={{ background: selectedColor }} />
              <span className="sel-label">Colour</span>
            </button>
            )}
            {!onlyPictures && (
            <button
              className={`sel-btn${menuPanel === 'fill' ? ' open' : ''}`}
              aria-label="Fill"
              aria-expanded={menuPanel === 'fill'}
              onClick={() => setMenuPanel((p) => (p === 'fill' ? null : 'fill'))}
            >
              <span
                className={`sel-swatch fill${selectedFill?.fill ? '' : ' none'}`}
                style={selectedFill?.fill ? { background: selectedFill.fill, opacity: Math.max(0.35, selectedFill.fillOpacity ?? DEFAULT_FILL_OPACITY) } : undefined}
              />
              <span className="sel-label">Fill</span>
            </button>
            )}
            <button
              className={`sel-btn${menuPanel === 'arrange' ? ' open' : ''}`}
              aria-label="Arrange"
              aria-expanded={menuPanel === 'arrange'}
              onClick={() => setMenuPanel((p) => (p === 'arrange' ? null : 'arrange'))}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="11" height="11" rx="2" /><rect x="9.5" y="9.5" width="11" height="11" rx="2" fill="currentColor" fillOpacity="0.25" /></svg>
              <span className="sel-label">Arrange</span>
            </button>
            <span className="sel-divider" />
            <button className="sel-btn" aria-label="Copy" onClick={copySelection}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" /></svg>
              <span className="sel-label">Copy</span>
            </button>
            <button className="sel-btn" aria-label="Cut" onClick={cutSelection}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6.5" cy="17.5" r="2.8" /><circle cx="17.5" cy="17.5" r="2.8" /><path d="M8.5 15.5 18 4M15.5 15.5 6 4" /></svg>
              <span className="sel-label">Cut</span>
            </button>
            <button className="sel-btn" aria-label="Duplicate" onClick={duplicateSelection}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="11" height="11" rx="2.5" /><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M14.5 12.5v4M12.5 14.5h4" /></svg>
              <span className="sel-label">Duplicate</span>
            </button>
            <button className="sel-btn danger" aria-label="Delete" onClick={deleteSelection}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" /></svg>
              <span className="sel-label">Delete</span>
            </button>
            {menuPanel === 'arrange' && (
              <div className="sel-panel sel-arrange" role="group" aria-label="Arrange">
                <button onClick={() => arrangeSelection('front')}>Bring to Front</button>
                <button onClick={() => arrangeSelection('forward')}>Bring Forward</button>
                <button onClick={() => arrangeSelection('backward')}>Send Backward</button>
                <button onClick={() => arrangeSelection('back')}>Send to Back</button>
              </div>
            )}
            {menuPanel === 'color' && (
              <div className="sel-panel" role="group" aria-label="Colours">
                <div className="sel-swatches">
                  {PEN_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`sel-color${c === selectedColor ? ' current' : ''}`}
                      style={{ background: c }}
                      aria-label={`Colour ${c}`}
                      onClick={() => recolorSelection(c)}
                    />
                  ))}
                </div>
              </div>
            )}
            {menuPanel === 'fill' && (
              <div className="sel-panel" role="group" aria-label="Fill">
                <div className="sel-swatches">
                  <button
                    className={`sel-color no-fill${selectedFill ? '' : ' current'}`}
                    aria-label="No fill"
                    onClick={() => fillSelection(null, fillOpacity)}
                  />
                  {PEN_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`sel-color${c === selectedFill?.fill ? ' current' : ''}`}
                      style={{ background: c }}
                      aria-label={`Fill ${c}`}
                      onClick={() => fillSelection(c, fillOpacity)}
                    />
                  ))}
                </div>
                <label className="sel-opacity">
                  <span>Opacity</span>
                  <Slider
                    value={fillOpacity}
                    min={0.05}
                    max={1}
                    step={0.05}
                    label="Fill opacity"
                    onInput={(v) => {
                      setFillOpacity(v);
                      previewFill(v);
                    }}
                    onCommit={(v) => {
                      const current = selectedFill?.fillOpacity ?? DEFAULT_FILL_OPACITY;
                      if (selectedFill?.fill && Math.abs(v - current) > 0.001) fillSelection(selectedFill.fill, v);
                      else endPreview();
                    }}
                  />
                  <span className="sel-value">{Math.round(fillOpacity * 100)}%</span>
                </label>
              </div>
            )}
          </div>
          {editShape
            ? editShape.shape.vertices.map((q, i) => (
                <div
                  key={i}
                  className="vertex-handle"
                  data-handle={`v${i}`}
                  aria-label={editShape.shape.closed ? `Corner ${i + 1}` : i === 0 ? 'Start of line' : 'End of line'}
                  style={{ left: (q.x - selection.bounds.x) * scale, top: (q.y - selection.bounds.y) * scale }}
                />
              ))
            : (['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'] as const).map((h) => (
                <div key={h} className={`selection-handle ${h}`} data-handle={h} aria-label="Resize" />
              ))}
          {!(editShape && !editShape.shape.closed) && (
            <div className="selection-rotate" data-handle="rotate" aria-label="Rotate">
              ↻
            </div>
          )}
        </div>
      )}
      <div ref={badgeRef} className="gesture-badge" aria-hidden="true" />
    </div>
  );
}
