import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { newId, type Page, type Stroke } from '../model/types';
import { applyRegion, DEFAULT_FILL_OPACITY, drawPage, drawPageParts, drawStroke, type CanvasRegion, type PixelRect } from './render';
import { adjustShape, polylinePoints, recognizeShape, type ShapeKind } from './shapes';
import { buildGuides, sameSnap, snapLineEnd, snapToPoint, type SnapGuides, type SnapResult } from './snapping';
import { pencilHaptic } from '../pencil/haptics';
import { makeImageStroke, onImageLoaded, preloadImages, readDropped, resolveDropped, storeImage } from './images';
import { shareOrDownload } from '../export/exporters';
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
import {
  PEN_COLORS,
  SHAPE_SIZE_RANGE,
  type PenSlot,
  type PointerSettings,
  type ShapeToolSettings,
  type TapeToolSettings,
  type TextToolSettings,
} from './palette';
import { templateStyle } from './templates';
import type { DashStyle, PenStyle, TextContent } from '../model/types';
import { boxCorners, DEFAULT_TEXT_WIDTH, makeTextStroke, retextStroke, TEXT_FONT_ORDER, TEXT_FONTS } from './text';
import { makeShapeStroke, makeTapeStroke } from './shapeTool';
import { revealedTape, TAPE_CHANGE } from './render';
import { noteTapHandled } from './tapSignal';
import { handwriting, inkImage, recognitionLanguage, typedTextOf } from '../search/textIndex';
import { getToken } from '../sync/auth';
import { DriveClient } from '../sync/drive';
import { displayColor } from './inkTheme';
import { audioStamp, getPlayback, onRecordingChange, seekRecording } from './recording';
import { DashSample } from '../ui/Icon';
import { describeLink, followLink, pdfLinks, type PdfLinkArea } from './links';
import { LinkDialog, LinkGlyph } from '../ui/LinkDialog';
import { edgeNear, getGuide, projectOnEdge, protractorDegrees, type GuideEdge } from './guides';
import {
  alignStrokes,
  distributeStrokes,
  expandGroups,
  flipStrokes,
  guideTargets,
  isSelectable,
  kindOf,
  regroup,
  setLocked,
  snapMove,
  getKeepAspect,
  setKeepAspect,
  type AlignMode,
  type Guide,
  type ItemKind,
} from './selection';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { getPdf, pdfPageText, renderPdfRegion } from '../pdf/pdf';
import { lineAt, pageTextFromRuns, snapHighlight, textInRect } from '../pdf/pdfText';
import type { PdfTextRun } from '../db/db';
import { noteHover, notePen, penActiveWithin } from './penState';
import { diagnostics, recordEvent, recordFrame } from './diagnostics';
import { hideHoverCursor, showHoverCursor } from './hoverCursor';

export type ToolKind = 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'laser' | 'text' | 'shape' | 'tape';

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
  /** Fine-tuning of the pen in hand (mirrors its slot). */
  penStyle?: PenStyle;
  /** Eraser leaves pen ink alone and only removes highlighter. */
  eraseHighlighterOnly?: boolean;
  text: TextToolSettings;
  shape: ShapeToolSettings;
  tape: TapeToolSettings;
  pointer: PointerSettings;
  /** Lasso: freehand loop or rectangle, and which kinds of items it picks up. */
  lasso?: { mode: 'free' | 'rect'; kinds: ItemKind[] };
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
  /** Night mode: dark paper, ink shown with flipped lightness (see inkTheme.ts). */
  dark?: boolean;
  /** In night mode, imported PDF pages are inverted too. */
  invertPdf?: boolean;
}

interface Gesture {
  pointerId: number;
  kind: 'ink' | 'erase' | 'lasso' | 'move' | 'scale' | 'rotate' | 'laser' | 'vertex' | 'shape' | 'tape' | 'text';
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
  /** Moving a selection: edges it can line up with, and the guides currently shown. */
  moveTargets: { xs: number[]; ys: number[] } | null;
  moveGuides: Guide[];
  /** Drawing along the ruler's edge or the protractor's arc (client px). */
  guideEdge: GuideEdge | null;
}

interface Selection {
  ids: Set<string>;
  bounds: Rect;
}

/** A text box being typed into. */
interface TextDraft {
  /** The box being changed, or null for a new one. */
  editing: Stroke | null;
  /** Top-left corner (page units). */
  at: Point;
  /** Box width in the text's own units. */
  width: number;
  /** On-page size of one text unit (a resized box keeps its scale while editing). */
  factor: number;
  content: string;
  color: string;
  style: Omit<TextToolSettings, 'color'>;
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
/**
 * The canvas is moved along before the visible part reaches its edge, by this fraction of the
 * screen height, so the newly drawn strip is still off screen.
 */
const VIEW_LEAD = 0.1;

/** Menus, buttons and sliders on the page (the Pencil and fingers operate them, not write). */
export function isControl(target: EventTarget | null): boolean {
  return !!(target as Element | null)?.closest?.(
    'button, input, select, textarea, label, [role="slider"], .selection-menu, .canvas-menu, .text-editor',
  );
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
/**
 * After a pinch, the editor first puts the scroll position back and only then asks the pages to
 * draw at the new zoom. Without this each page drew twice (new canvases + all ink, both times).
 */
let layoutDeferred = false;
export function deferPageLayout(): void {
  layoutDeferred = true;
}
export function relayoutPages(): void {
  layoutDeferred = false;
  window.dispatchEvent(new Event(RELAYOUT));
}
export type PageAction = { pageId: string; action: 'insertPictures' | 'paste' | 'selectAll'; files: Blob[] };

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

export function InkPage({ page, scale, settings, scroller, onChange, onHoverHold, onRequestSelect, dark = false, invertPdf = false }: Props) {
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
  const textEditorRef = useRef<HTMLDivElement>(null);
  const formatBarRef = useRef<HTMLDivElement>(null);
  /** A text box is open for typing (mirrors textEdit, which is declared further down). */
  const [textEditOpen, setTextEditOpen] = useState(false);
  // Imported PDF page under the ink.
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const pdfRenderRef = useRef<{ task: RenderTask | null; generation: number }>({ task: null, generation: 0 });
  const [pdfMissing, setPdfMissing] = useState(false);
  /** Links inside the imported PDF page (tap with a finger to follow). */
  const [pdfLinkAreas, setPdfLinkAreas] = useState<PdfLinkArea[]>([]);
  /** Text of the imported PDF page (copying text, text-aware highlighter). */
  const [pdfRuns, setPdfRuns] = useState<PdfTextRun[]>([]);
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

  const pageWidth = page.width;
  const pageHeight = page.height;
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
      const visible =
        visibleRight > visibleLeft && visibleBottom > visibleTop
          ? toPage(visibleLeft, visibleTop, visibleRight, visibleBottom)
          : needed;
      // The canvas keeps one size for a given zoom and screen (the screen plus its margins, or
      // the whole page if that is smaller) and slides along the page. A canvas that never
      // changes size is never re-created, and what it already shows can be kept when it moves.
      const width = Math.min(pageWidth, (sr.width * (1 + 2 * VIEW_MARGIN)) / scale);
      const height = Math.min(pageHeight, (sr.height * (1 + 2 * VIEW_MARGIN)) / scale);
      const k = Math.min(scale * dpr, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
      const pixelWidth = Math.max(1, Math.ceil(width * k));
      const pixelHeight = Math.max(1, Math.ceil(height * k));
      const ink = inkRef.current;
      const live = liveRef.current;
      const current = regionRef.current;
      // The live layer (ink being written) is only needed on a page that is actually on screen;
      // pages waiting in the margin do without it, which saves a full canvas of memory each.
      const onScreen = visibleRight > visibleLeft && visibleBottom > visibleTop;
      const fitLive = (region: CanvasRegion) => {
        if (!live) return;
        const w = onScreen || gestureRef.current ? pixelWidth : 0;
        const h = w ? pixelHeight : 0;
        if (live.width !== w || live.height !== h) {
          live.width = w;
          live.height = h;
        }
        live.style.left = `${region.x * scale}px`;
        live.style.top = `${region.y * scale}px`;
        live.style.width = `${(pixelWidth / k) * scale}px`;
        live.style.height = `${(pixelHeight / k) * scale}px`;
      };
      const sameSize =
        !!current && !!ink && Math.abs(current.k - k) < 1e-6 && ink.width === pixelWidth && ink.height === pixelHeight;
      if (!force && current && sameSize) {
        // Move on a little before the visible part reaches the canvas edge (in the direction of
        // scrolling), so the strip that has to be drawn is still off screen.
        const lead = (sr.height * VIEW_LEAD) / scale;
        const direction = scrollDirection.current;
        const y0 = Math.max(0, visible.y - (direction < 0 ? lead : 0));
        const y1 = Math.min(pageHeight, visible.y + visible.height + (direction > 0 ? lead : 0));
        if (contains(current, { x: visible.x, y: y0, width: visible.width, height: y1 - y0 })) {
          if (live && (live.width !== 0) !== onScreen && !gestureRef.current) fitLive(current);
          return;
        }
      }

      // On whole canvas pixels, so kept ink lines up exactly after a move.
      const snap = (v: number) => Math.round(v * k) / k;
      const region: CanvasRegion = {
        x: snap(Math.max(0, Math.min(needed.x, pageWidth - width))),
        y: snap(Math.max(0, Math.min(needed.y, pageHeight - height))),
        width,
        height,
        k,
      };
      regionRef.current = region;
      diagnostics.canvasPixels = pixelWidth * pixelHeight;

      const dx = current ? Math.round((current.x - region.x) * k) : 0;
      const dy = current ? Math.round((current.y - region.y) * k) : 0;
      const ctx = ink?.getContext('2d');
      if (
        !force &&
        sameSize &&
        ctx &&
        paintedRef.current.region === current &&
        !gestureRef.current &&
        !laserRef.current.length &&
        Math.abs(dx) < pixelWidth &&
        Math.abs(dy) < pixelHeight
      ) {
        // Scrolling: slide the picture inside the canvas and draw only the uncovered strips.
        ink.style.left = `${region.x * scale}px`;
        ink.style.top = `${region.y * scale}px`;
        fitLive(region);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'copy';
        ctx.drawImage(ink, dx, dy);
        ctx.restore();
        const keptTop = Math.max(0, dy);
        const keptBottom = pixelHeight + Math.min(0, dy);
        const parts: PixelRect[] = [];
        if (dy > 0) parts.push({ x: 0, y: 0, width: pixelWidth, height: dy });
        else if (dy < 0) parts.push({ x: 0, y: keptBottom, width: pixelWidth, height: -dy });
        if (dx > 0) parts.push({ x: 0, y: keptTop, width: dx, height: keptBottom - keptTop });
        else if (dx < 0) parts.push({ x: pixelWidth + dx, y: keptTop, width: -dx, height: keptBottom - keptTop });
        drawPageParts(ctx, strokesRef.current, region, hiddenRef.current, parts);
        paintedRef.current.region = region;
      } else {
        if (ink) {
          // Setting a canvas size re-creates (and clears) it: only when the size really changes.
          if (ink.width !== pixelWidth || ink.height !== pixelHeight) {
            ink.width = pixelWidth;
            ink.height = pixelHeight;
          }
          ink.style.left = `${region.x * scale}px`;
          ink.style.top = `${region.y * scale}px`;
          ink.style.width = `${(pixelWidth / k) * scale}px`;
          ink.style.height = `${(pixelHeight / k) * scale}px`;
        }
        fitLive(region);
        const liveCtx = live?.width ? live.getContext('2d') : null;
        liveCtx?.setTransform(1, 0, 0, 1, 0, 0);
        liveCtx?.clearRect(0, 0, pixelWidth, pixelHeight);
        paintInk(true);
      }
      void renderPdf();
    },
    [scroller, scale, dpr, pageWidth, pageHeight, paintInk, renderPdf],
  );

  // Always the layout for the zoom being shown: the editor asks for a relayout from its own
  // layout effect, before this page's listeners below have been re-attached for the new zoom.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

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
      if (doc) void pdfLinks(doc, background.fileId, background.pageIndex, page.width, page.height).then((areas) => alive && setPdfLinkAreas(areas));
      if (doc) void pdfPageText(doc, background.pageIndex).then((t) => alive && setPdfRuns(t.runs)).catch(() => undefined);
    });
    return () => {
      alive = false;
      pdfRenderRef.current.task?.cancel();
    };
  }, [background, renderPdf, pdfAvailable]);

  // Re-layout when zoom changes (before paint, so nothing flashes) …
  useLayoutEffect(() => {
    if (!layoutDeferred) layout(true);
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
    const relayout = () => layoutRef.current(true);
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

  // Playback moved on: ink appears as the recording reaches it.
  useEffect(() => {
    let last = '';
    return onRecordingChange(() => {
      const p = getPlayback();
      const key = p ? `${p.rec}|${Math.floor(p.t / 250)}` : '';
      if (key === last) return;
      last = key;
      if (p ? page.strokes.some((s) => s.audio?.rec === p.rec) : true) paintInk(true);
    });
  });

  // Night mode switched: redraw the ink in its new colours.
  const firstDark = useRef(true);
  useEffect(() => {
    if (firstDark.current) {
      firstDark.current = false;
      return;
    }
    paintInk(true);
  }, [dark, paintInk]);

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
    const { laserColor, laserSize, laserTrail } = settings.pointer ?? { laserColor: '#ff3b30', laserSize: 10, laserTrail: LASER_LIFE_MS };
    const life = Math.max(120, laserTrail || 0);
    // Drop faded points (the trail being drawn keeps at least its tip).
    laserRef.current = laserRef.current
      .map((trail, i, all) => {
        const live = drawing && i === all.length - 1;
        // "Dot only": no trail, just the tip while it moves.
        if (!laserTrail) return live && trail.length ? [trail[trail.length - 1]!] : [];
        const kept = trail.filter((q) => now - q.t < life);
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
        const fade = Math.max(0, 1 - (now - b.t) / life);
        // Soft glow, then a bright core.
        ctx.globalAlpha = 0.25 * fade;
        ctx.strokeStyle = laserColor;
        ctx.lineWidth = laserSize * 1.2 * px;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.globalAlpha = fade;
        ctx.lineWidth = laserSize * 0.4 * px;
        ctx.stroke();
      }
      const tip = trail[trail.length - 1]!;
      const fade = laserTrail ? Math.max(0, 1 - (now - tip.t) / life) : 1;
      ctx.globalAlpha = 0.3 * (drawing ? 1 : fade);
      ctx.fillStyle = laserColor;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, laserSize * px, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = drawing ? 1 : fade;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, laserSize * 0.5 * px, 0, Math.PI * 2);
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
  const placeVertexHandles = (vertices: Point[], stroke?: Stroke, closed = false) => {
    const box = selectionBoxRef.current;
    if (!box || !selection) return;
    // The frame (and the menu on it) follows the shape while a point is dragged.
    const b = stroke ? strokeBounds(strokeThrough(stroke, vertices, closed, stroke.id)) : selection.bounds;
    box.style.left = `${b.x * scale}px`;
    box.style.top = `${b.y * scale}px`;
    box.style.width = `${b.width * scale}px`;
    box.style.height = `${b.height * scale}px`;
    vertices.forEach((q, i) => {
      const el = box.querySelector<HTMLElement>(`[data-handle="v${i}"]`);
      if (!el) return;
      el.style.left = `${(q.x - b.x) * scale}px`;
      el.style.top = `${(q.y - b.y) * scale}px`;
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
  /** Size / angle readout; at the selection's centre, or at (left, top) in page CSS px. */
  const showBadge = (text: string, left?: number, top?: number) => {
    const el = badgeRef.current;
    if (!el) return;
    if (left === undefined || top === undefined) {
      const box = selectionBoxRef.current?.getBoundingClientRect();
      const page = containerRef.current?.getBoundingClientRect();
      if (!box || !page) return;
      left = box.left + box.width / 2 - page.left;
      top = box.top + box.height / 2 - page.top - 14;
    }
    el.textContent = text;
    el.style.display = 'block';
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
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
    ctx.strokeStyle = '#637381';
    ctx.fillStyle = '#637381';
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
      ...(!highlighter && settings.penStyle && Object.keys(settings.penStyle).length ? { penStyle: settings.penStyle } : {}),
    };
  };

  /** The shape or tape being dragged out, as it would be saved. */
  const dragItem = (g: Gesture, id = 'live'): Stroke | null => {
    const a = g.moveStart;
    const b = g.scaleFrom;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 3) return null;
    if (g.kind === 'tape') return makeTapeStroke(a, b, settings.tape.color, settings.tape.width, id);
    const s = settings.shape;
    return makeShapeStroke(s.kind, a, b, { color: s.color, size: s.size, dash: s.dash, fill: s.fill, fillOpacity: s.fillOpacity }, id);
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
    if (g.kind === 'shape' || g.kind === 'tape') {
      const item = dragItem(g);
      if (item) drawStroke(ctx, item, true);
      if (item && g.kind === 'shape') {
        const b = strokeBounds(item);
        showBadge(`${Math.round(b.width)} × ${Math.round(b.height)}`, (b.x + b.width / 2) * scale, b.y * scale - 22);
      }
    } else if (g.kind === 'lasso' && g.lasso.length > 1) {
      ctx.setLineDash([6 / scale, 5 / scale]);
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = '#637381';
      ctx.beginPath();
      g.lasso.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
    } else if (g.kind === 'move' && selection) {
      if (g.moveGuides.length) {
        ctx.save();
        ctx.strokeStyle = '#919eab';
        ctx.lineWidth = 1 / scale;
        ctx.setLineDash([5 / scale, 4 / scale]);
        ctx.beginPath();
        for (const guide of g.moveGuides) {
          if (guide.axis === 'x') {
            ctx.moveTo(guide.at, 0);
            ctx.lineTo(guide.at, page.height);
          } else {
            ctx.moveTo(0, guide.at);
            ctx.lineTo(page.width, guide.at);
          }
        }
        ctx.stroke();
        ctx.restore();
      }
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
      // live = true: draw the new outline (the saved outline for this id is the old shape).
      drawStroke(ctx, strokeThrough(v.stroke, v.current, v.shape.closed, v.stroke.id), true);
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

  /**
   * Keeps the selection menu (and its pop-up panel) fully on screen: above the selection if it
   * fits, else below it, else floating inside the visible area. Never under a floating tool bar.
   */
  /**
   * The part of the screen where floating menus may go: the visible page area (without scroll
   * bars), above the on-screen keyboard, and not under a floating tool bar.
   */
  const visibleBounds = () => {
    const view = (scroller ?? document.documentElement).getBoundingClientRect();
    // Inner size (without scroll bars): a menu must never make the page scroll sideways.
    const innerRight = scroller ? view.left + scroller.clientWidth : view.right;
    const innerBottom = scroller ? view.top + scroller.clientHeight : view.bottom;
    let top = Math.max(view.top, 0) + 8;
    let bottom = Math.min(innerBottom, window.innerHeight) - 8;
    let left = Math.max(view.left, 0) + 8;
    let right = Math.min(innerRight, window.innerWidth) - 8;
    // The iPad keyboard covers the bottom of the screen without changing the window size.
    const vv = window.visualViewport;
    if (vv) {
      top = Math.max(top, vv.offsetTop + 8);
      bottom = Math.min(bottom, vv.offsetTop + vv.height - 8);
    }
    const palette = document.querySelector<HTMLElement>('.tool-palette.floating:not(.minimized)');
    if (palette) {
      const p = palette.getBoundingClientRect();
      if (palette.classList.contains('side-top')) top = Math.max(top, p.bottom + 8);
      else if (palette.classList.contains('side-bottom')) bottom = Math.min(bottom, p.top - 8);
      else if (palette.classList.contains('side-left')) left = Math.max(left, p.right + 8);
      else if (palette.classList.contains('side-right')) right = Math.min(right, p.left - 8);
    }
    return { top, bottom, left, right };
  };

  /** The text formatting bar: above the text box if it fits, else below, else inside the screen. */
  const placeFormatBar = () => {
    const bar = formatBarRef.current;
    const editor = textEditorRef.current;
    if (!bar || !editor) return;
    const { top, bottom, left, right } = visibleBounds();
    bar.style.left = '0px';
    bar.style.maxWidth = `${Math.max(200, right - left)}px`;
    const e = editor.getBoundingClientRect();
    const h = bar.offsetHeight;
    const above = e.top - h - 10;
    const below = e.bottom + 10;
    const y = above >= top ? above : below + h <= bottom ? below : Math.max(top, Math.min(bottom - h, above));
    bar.style.top = `${y - e.top}px`;
    const r = bar.getBoundingClientRect();
    let dx = 0;
    if (r.right > right) dx = right - r.right;
    if (r.left + dx < left) dx = left - r.left;
    bar.style.left = `${dx}px`;
  };

  const placeMenu = () => {
    const menu = menuRef.current;
    const box = selectionBoxRef.current;
    if (!menu || !box) return;
    menu.style.transform = '';
    menu.style.left = '0px';
    const { top, bottom, left, right } = visibleBounds();
    // Never wider than the visible area (it wraps onto two rows instead).
    menu.style.maxWidth = `${Math.max(200, right - left)}px`;
    const b = box.getBoundingClientRect();
    const h = menu.offsetHeight;
    const above = b.top - h - 12;
    // Below the selection means below its rotate handle.
    const below = b.bottom + 46;
    const y = above >= top ? above : below + h <= bottom ? below : Math.max(top, Math.min(bottom - h, above));
    menu.style.top = `${y - b.top}px`;
    const r = menu.getBoundingClientRect();
    let dx = 0;
    if (r.right > right) dx = right - r.right;
    if (r.left + dx < left) dx = left - r.left;
    // Moved with `left` (not a transform), so it never widens the scrollable area.
    if (dx) menu.style.left = `${dx}px`;
    const panel = menu.querySelector<HTMLElement>('.sel-panel');
    if (panel) {
      panel.classList.remove('up');
      panel.style.left = '0px';
      if (panel.getBoundingClientRect().bottom > bottom && y - panel.offsetHeight - 6 >= top) panel.classList.add('up');
      const pr = panel.getBoundingClientRect();
      let px = 0;
      if (pr.right > right) px = right - pr.right;
      if (pr.left + px < left) px = left - pr.left;
      if (px) panel.style.left = `${px}px`;
    }
  };
  const placeMenuRef = useRef(placeMenu);
  placeMenuRef.current = placeMenu;
  const placeFormatBarRef = useRef(placeFormatBar);
  placeFormatBarRef.current = placeFormatBar;
  useLayoutEffect(() => {
    if (selection) placeMenu();
    if (textEditRef.current) placeFormatBar();
  });
  // Follow scrolling, resizing and the keyboard while something is selected or being typed.
  const floating = !!selection || !!textEditOpen;
  useEffect(() => {
    if (!floating) return;
    let raf: number | null = null;
    const onMove = () => {
      if (raf == null)
        raf = requestAnimationFrame(() => {
          raf = null;
          placeMenuRef.current();
          placeFormatBarRef.current();
        });
    };
    const vv = window.visualViewport;
    scroller?.addEventListener('scroll', onMove, { passive: true });
    window.addEventListener('resize', onMove);
    vv?.addEventListener('resize', onMove);
    vv?.addEventListener('scroll', onMove);
    return () => {
      scroller?.removeEventListener('scroll', onMove);
      window.removeEventListener('resize', onMove);
      vv?.removeEventListener('resize', onMove);
      vv?.removeEventListener('scroll', onMove);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [floating, scroller]);

  const requestRender = () => {
    if (frameRef.current == null) frameRef.current = requestAnimationFrame(renderLive);
  };

  /** What the eraser may touch: never pictures or text; only highlighter if so set. */
  const erasable = (s: Stroke) =>
    !s.locked && s.tool !== 'image' && s.tool !== 'text' && (!settings.eraseHighlighterOnly || s.tool === 'highlighter');

  const eraseAt = (g: Gesture, p: Point) => {
    const radius = settings.eraserSize / 2;
    let changed = false;
    if (settings.eraserMode === 'partial') {
      for (const s of page.strokes) {
        if (!erasable(s)) continue;
        if (s.tool === 'tape') {
          // Tape comes off whole.
          if (!g.erased.has(s.id) && !g.pieces.has(s.id) && strokeHit(s, p, radius)) {
            g.pieces.set(s.id, []);
            hiddenRef.current.add(s.id);
            changed = true;
          }
          continue;
        }
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
      if (!erasable(s)) continue;
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
      if (isSelectable(s) && strokeHit(s, p, radius)) return s;
    }
    return undefined;
  };

  /** The topmost locked item under a point (long-press it to unlock). */
  const lockedAt = (p: Point): Stroke | undefined => {
    const radius = Math.max(5, 12 / scale);
    for (let i = page.strokes.length - 1; i >= 0; i--) {
      const s = page.strokes[i]!;
      if (s.locked && strokeHit(s, p, radius)) return s;
    }
    return undefined;
  };

  /** The topmost tape under a point. */
  const tapeAt = (p: Point): Stroke | undefined => {
    for (let i = page.strokes.length - 1; i >= 0; i--) {
      const s = page.strokes[i]!;
      if (s.tool === 'tape' && strokeHit(s, p, 2)) return s;
    }
    return undefined;
  };

  /** Peek under tape, or cover it up again (this device, this session only). */
  // Flashcard mode reveals and covers tape from outside the page.
  useEffect(() => {
    const repaint = () => paintInk(true);
    window.addEventListener(TAPE_CHANGE, repaint);
    return () => window.removeEventListener(TAPE_CHANGE, repaint);
  }, [paintInk]);

  const toggleTape = (s: Stroke) => {
    if (revealedTape.has(s.id)) revealedTape.delete(s.id);
    else revealedTape.add(s.id);
    paintInk(true);
  };

  /** The topmost text box under a point. */
  const textAt = (p: Point): Stroke | undefined => {
    for (let i = page.strokes.length - 1; i >= 0; i--) {
      const s = page.strokes[i]!;
      if (s.tool === 'text' && strokeHit(s, p, 2)) return s;
    }
    return undefined;
  };

  /** Selects items (whole groups), or clears the selection when none are left. */
  const selectIds = (ids: Iterable<string>) => {
    const all = expandGroups(page.strokes, ids);
    const picked = page.strokes.filter((x) => all.has(x.id));
    const bounds = unionRects(picked.map(strokeBounds));
    setSelection(picked.length && bounds ? { ids: new Set(picked.map((x) => x.id)), bounds } : null);
  };
  const selectStroke = (s: Stroke) => selectIds([s.id]);

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
        ? settings.pointer?.laserSize ?? 10
        : tool === 'eraser'
          ? settings.eraserSize * scale
          : tool === 'highlighter'
            ? settings.highlighterSize * scale
            : tool === 'tape'
              ? settings.tape.width * scale
              : tool === 'shape'
                ? 18
                : Math.max(settings.pointer?.cursor === 'dot' ? 5 : 9, settings.penSize * scale);
    if (tool === 'eraser' || settings.hoverPreview !== false) {
      showHoverCursor(e.nativeEvent, {
        tool,
        size,
        variant: settings.pointer?.cursor,
        color:
          tool === 'highlighter'
            ? settings.highlighterColor
            : tool === 'laser'
              ? settings.pointer?.laserColor ?? '#ff3b30'
              : tool === 'tape'
                ? settings.tape.color
                : tool === 'shape'
                  ? displayColor(settings.shape.color)
                  : displayColor(settings.color),
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
            const locked = lockedAt(at);
            setCanvasMenu({ ...at, lockedId: locked?.id });
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
      moveTargets: null,
      moveGuides: [],
      guideEdge: null,
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
      g.moveTargets = guideTargets(page.strokes, selection.ids, page);
      for (const id of selection.ids) hiddenRef.current.add(id);
      paintInk(true);
    } else if (settings.tool === 'laser') {
      g.kind = 'laser';
      laserRef.current.push([{ ...p, t: performance.now() }]);
    } else if (settings.tool === 'shape' || settings.tool === 'tape' || settings.tool === 'text') {
      if (selection) setSelection(null);
      g.kind = settings.tool;
      g.moveStart = p;
      g.scaleFrom = p;
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
    // Started next to the ruler or protractor: the stroke follows its edge.
    const drawingGuide = getGuide();
    if (g.kind === 'ink' && drawingGuide) {
      const edge = edgeNear(drawingGuide, { x: e.clientX, y: e.clientY });
      if (edge) {
        g.guideEdge = edge;
        g.holdSince = Infinity; // no hold-to-snap shapes along a ruler
        const q = guidedPoint(g, e.clientX, e.clientY);
        g.points = [q.x, q.y, pressureOf(native)];
      }
    }
    gestureRef.current = g;
    requestRender();
  };

  /** A client point moved onto the guide edge, in page units. */
  const guidedPoint = (g: Gesture, clientX: number, clientY: number): Point => {
    const inset = ((settings.tool === 'highlighter' ? settings.highlighterSize : settings.penSize) * scale) / 2;
    const q = g.guideEdge ? projectOnEdge(g.guideEdge, { x: clientX, y: clientY }, inset) : { x: clientX, y: clientY };
    return { x: (q.x - g.origin.left) / scale, y: (q.y - g.origin.top) / scale };
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
          if (g.guideEdge) {
            const q = guidedPoint(g, ev.clientX, ev.clientY);
            g.points.push(q.x, q.y, pressureOf(ev));
            growDirty(g, q.x, q.y);
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
          if (settings.lasso?.mode === 'rect') {
            const a = g.moveStart;
            g.lasso = [a, { x: p.x, y: a.y }, p, { x: a.x, y: p.y }];
          } else g.lasso.push(p);
          break;
        case 'laser':
          laserRef.current[laserRef.current.length - 1]?.push({ ...p, t: performance.now() });
          break;
        case 'move':
          {
            const raw = { x: p.x - g.moveStart.x, y: p.y - g.moveStart.y };
            if (selection && g.moveTargets) {
              const snapped = snapMove(selection.bounds, raw, g.moveTargets, Math.max(3, 8 / scale));
              g.offset = snapped.offset;
              g.moveGuides = snapped.guides;
            } else g.offset = raw;
          }
          break;
        case 'shape':
        case 'tape':
        case 'text':
          g.scaleFrom = p;
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
          // Corner handles keep the proportions (unless turned off in Arrange).
          if (g.axis.x && g.axis.y && getKeepAspect()) {
            const k = Math.max(Math.abs(g.sx), Math.abs(g.sy));
            g.sx = Math.sign(g.sx || 1) * k;
            g.sy = Math.sign(g.sy || 1) * k;
          }
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
          placeVertexHandles(v.current, v.stroke, v.shape.closed);
          break;
        }
      }
    }
    if (g.kind === 'ink' && g.snapped) {
      g.lastSampleAt = performance.now();
    } else if (g.kind === 'ink' && g.guideEdge) {
      // Along a guide: show the length (ruler) or angle (protractor) instead of predicting.
      g.predicted = [];
      g.needsDraw = true;
      g.lastSampleAt = performance.now();
      const n = g.points.length;
      const last = { x: g.points[n - 3]!, y: g.points[n - 2]! };
      const guide = getGuide();
      const text =
        guide?.kind === 'protractor'
          ? `${protractorDegrees(guide, { x: g.origin.left + last.x * scale, y: g.origin.top + last.y * scale })}°`
          : `${(Math.hypot(last.x - g.points[0]!, last.y - g.points[1]!) * (25.4 / 96) / 10).toFixed(1)} cm`;
      showBadge(text, last.x * scale, last.y * scale - 36);
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
        // A link in the imported PDF: follow it.
        const pdfLink = pdfLinkAreas.find((a) => rectContains(a, press.at));
        if (pdfLink && background) {
          noteTapHandled();
          if (pdfLink.url) followLink({ kind: 'url', url: pdfLink.url });
          else if (pdfLink.pageIndex !== undefined) followLink({ kind: 'pdfPage', fileId: background.fileId, pageIndex: pdfLink.pageIndex });
          return;
        }
        // Playing a recording: tapping ink written during it jumps the audio there.
        const playing = getPlayback();
        if (playing) {
          const timed = strokeAt(press.at);
          if (timed?.audio?.rec === playing.rec) {
            noteTapHandled();
            seekRecording(playing.rec, Math.max(0, timed.audio.t - 1500));
            return;
          }
        }
        // Tapping tape peeks under it (like flash cards); tapping ink selects it.
        const tape = tapeAt(press.at);
        const hit = strokeAt(press.at);
        if (tape || hit) noteTapHandled();
        if (tape && (!hit || hit.id === tape.id || hit.createdAt < tape.createdAt)) toggleTape(tape);
        else if (hit && selection && !selection.ids.has(hit.id)) {
          // Something is already selected: a finger tap adds to it (tap empty paper to clear).
          selectIds([...selection.ids, hit.id]);
        } else if (hit) selectStroke(hit);
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
          // Written while recording: remember the moment, for synced playback.
          const stamp = audioStamp();
          const stroke: Stroke = { ...liveStroke(g, false), id: newId(), ...(stamp ? { audio: stamp } : {}) };
          // Text-aware highlighter: a sideways swipe over PDF text becomes neat bands on the lines.
          const bands = stroke.tool === 'highlighter' && !g.snapped ? snapHighlight(stroke.points, stroke.size, pdfRuns) : null;
          const made: Stroke[] = bands
            ? bands.map((b, i) => ({ ...stroke, id: i ? newId() : stroke.id, points: [b.x0, b.y, 0.5, b.x1, b.y, 0.5], size: b.height, hasPressure: false }))
            : [stroke];
          if (bands) requestRender();
          const ctx = inkRef.current?.getContext('2d');
          const region = regionRef.current;
          if (ctx && region && !bands) {
            applyRegion(ctx, region);
            drawStroke(ctx, stroke); // show immediately; the saved page won't need a repaint
            paintedRef.current.ids.add(stroke.id);
          }
          onChange(page.id, made, []);
          // Like Drawboard: a recognised shape stays selected, ready to move, resize or rotate.
          if (g.snapped) setSelection({ ids: new Set([stroke.id]), bounds: strokeBounds(stroke) });
          break;
        }
        case 'shape':
        case 'tape': {
          const item = dragItem(g, newId());
          if (!item) {
            // A tap with the tape tool peeks under tape.
            const tape = g.kind === 'tape' ? tapeAt(g.moveStart) : undefined;
            if (tape) toggleTape(tape);
            break;
          }
          paintNow([item]);
          onChange(page.id, [item], []);
          if (g.kind === 'shape') setSelection({ ids: new Set([item.id]), bounds: strokeBounds(item) });
          break;
        }
        case 'text': {
          const existing = textAt(g.moveStart);
          if (existing && Math.hypot(g.scaleFrom.x - g.moveStart.x, g.scaleFrom.y - g.moveStart.y) < 6) {
            startTextEdit(existing);
            break;
          }
          // Drag sideways to choose the box width; a tap gives the standard width.
          const dx = g.scaleFrom.x - g.moveStart.x;
          const width = Math.min(page.width - 16, Math.abs(dx) > 40 ? Math.abs(dx) : DEFAULT_TEXT_WIDTH);
          const start = Math.abs(dx) > 40 ? Math.min(g.moveStart.x, g.scaleFrom.x) : g.moveStart.x;
          // Near the right edge the box slides left, so it keeps its width instead of being squeezed.
          const x = Math.max(8, Math.min(start, page.width - width - 8));
          startTextEdit(null, { x, y: Math.max(4, g.moveStart.y - settings.text.size * 0.9) }, width);
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
          const kinds = settings.lasso?.kinds;
          const picked = page.strokes.filter(
            (s) => isSelectable(s) && (!kinds?.length || kinds.includes(kindOf(s))) && strokeInLasso(s, g.lasso),
          );
          if (picked.length) selectIds(picked.map((s) => s.id));
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
    if (g.kind === 'shape') hideBadge();
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
    const targets = page.strokes.filter((s) => selection.ids.has(s.id) && (s.tool === 'pen' || s.tool === 'highlighter'));
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
    const targets = page.strokes.filter((s) => selection.ids.has(s.id) && (s.tool === 'pen' || s.tool === 'highlighter'));
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
  const [linking, setLinking] = useState(false);
  const [keepAspect, setKeepAspectState] = useState(getKeepAspect);
  /** Which pop-up of the selection menu is open. */
  const [menuPanel, setMenuPanel] = useState<'color' | 'fill' | 'arrange' | 'style' | null>(null);
  const onlyPictures = !!selection && page.strokes.every((s) => !selection.ids.has(s.id) || s.tool === 'image');
  /** Fill applies to ink and shapes, not to pictures, text or tape. */
  const canFill = !!selection && page.strokes.some((s) => selection.ids.has(s.id) && (s.tool === 'pen' || s.tool === 'highlighter'));
  const singleText = !!selection && selection.ids.size === 1 && page.strokes.some((s) => selection.ids.has(s.id) && s.tool === 'text');
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
  /** Long-press menu on the paper (with the locked item under the finger, if any). */
  const [canvasMenu, setCanvasMenu] = useState<(Point & { lockedId?: string }) | null>(null);
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
    if (!(await pasteFromSystem(at))) alert('Nothing to paste. Copy ink or a picture first.');
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
      if (detail.action === 'selectAll') selectAllOnPage();
      else if (detail.action === 'insertPictures') void insertPictures(detail.files, null);
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

  // ---- Text boxes ------------------------------------------------------------------------
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [textEdit, setTextEdit] = useState<TextDraft | null>(null);
  const textEditRef = useRef(textEdit);
  textEditRef.current = textEdit;
  useEffect(() => setTextEditOpen(!!textEdit), [!!textEdit]);

  /** Opens the text editor on a box (or a new one at `at`). Focuses synchronously so the iPad keyboard opens. */
  const startTextEdit = (existing: Stroke | null, at?: Point, width?: number) => {
    if (textEditRef.current) commitText();
    let draft: TextDraft;
    if (existing?.text) {
      const [tl, tr] = boxCorners(existing);
      const t = existing.text;
      draft = {
        editing: existing,
        at: tl,
        width: t.width,
        factor: Math.hypot(tr.x - tl.x, tr.y - tl.y) / (t.width || 1),
        content: t.content,
        color: existing.color,
        style: { font: t.font, size: t.size, bold: !!t.bold, italic: !!t.italic, underline: !!t.underline, align: t.align ?? 'left', background: t.background ?? null },
      };
      hiddenRef.current.add(existing.id);
      paintInk(true);
      setSelection(null);
    } else {
      const s = settings.text;
      draft = {
        editing: null,
        at: at ?? visibleCenter(),
        width: width ?? DEFAULT_TEXT_WIDTH,
        factor: 1,
        content: '',
        color: s.color,
        style: { font: s.font, size: s.size, bold: s.bold, italic: s.italic, underline: s.underline, align: s.align, background: s.background },
      };
    }
    const area = textAreaRef.current;
    if (area) {
      area.value = draft.content;
      area.focus({ preventScroll: true });
    }
    setTextEdit(draft);
  };

  const commitText = () => {
    const d = textEditRef.current;
    if (!d) return;
    textEditRef.current = null;
    setTextEdit(null);
    textAreaRef.current?.blur();
    const content = d.content.replace(/\s+$/, '');
    const { background, ...style } = d.style;
    const text: Omit<TextContent, 'height'> = { ...style, ...(background ? { background } : {}), content, width: d.width };
    if (d.editing?.text) {
      const before = d.editing.text;
      const same =
        content === before.content &&
        d.color === d.editing.color &&
        JSON.stringify({ ...before, height: 0 }) === JSON.stringify({ ...text, height: 0 });
      if (same) {
        hiddenRef.current.delete(d.editing.id);
        paintInk(true);
        return;
      }
      if (!content) {
        onChange(page.id, [], [d.editing.id]);
        return;
      }
      const { background: _bg, ...rest } = before;
      const next = retextStroke({ ...d.editing, text: { ...rest, height: before.height } as TextContent }, text, d.color);
      paintNow([next]);
      onChange(page.id, [next], [d.editing.id]);
      return;
    }
    if (!content) return;
    const stroke = makeTextStroke(d.at, text, d.color);
    paintNow([stroke]);
    onChange(page.id, [stroke], []);
  };
  const commitTextRef = useRef(commitText);
  commitTextRef.current = commitText;

  // Tapping anywhere outside the text box (or switching tools) finishes editing.
  useEffect(() => {
    if (!textEdit) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.('.text-editor')) commitTextRef.current();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [!!textEdit]);
  useEffect(() => {
    if (settings.tool !== 'text') commitTextRef.current();
  }, [settings.tool]);
  // Grow the box with its text.
  useLayoutEffect(() => {
    const area = textAreaRef.current;
    if (!area || !textEdit) return;
    area.style.height = '0px';
    area.style.height = `${area.scrollHeight}px`;
  }, [textEdit, scale]);

  const patchDraft = (patch: Partial<TextDraft['style']> & { color?: string }) => {
    const { color, ...style } = patch;
    setTextEdit((d) => (d ? { ...d, ...(color ? { color } : {}), style: { ...d.style, ...style } } : d));
    // Keep the keyboard up while formatting.
    requestAnimationFrame(() => textAreaRef.current?.focus({ preventScroll: true }));
  };

  const editSelectedText = () => {
    const s = selection && page.strokes.find((x) => selection.ids.has(x.id) && x.tool === 'text');
    if (s) startTextEdit(s);
  };

  // ---- Line style of selected shapes / ink ---------------------------------------------------
  const restyleSelection = (patch: { dash?: DashStyle | null; arrowStart?: boolean; arrowEnd?: boolean; size?: number }) => {
    if (!selection) return;
    const targets = page.strokes.filter((s) => selection.ids.has(s.id) && s.tool === 'pen');
    if (!targets.length) return;
    const next = targets.map((s) => {
      const out: Stroke = { ...s, id: newId() };
      if ('dash' in patch) {
        if (patch.dash) out.dash = patch.dash;
        else delete out.dash;
      }
      if (patch.arrowStart !== undefined) {
        if (patch.arrowStart) out.arrowStart = true;
        else delete out.arrowStart;
      }
      if (patch.arrowEnd !== undefined) {
        if (patch.arrowEnd) out.arrowEnd = true;
        else delete out.arrowEnd;
      }
      if (patch.size !== undefined) out.size = patch.size;
      return out;
    });
    paintNow(next);
    onChange(page.id, next, targets.map((s) => s.id));
    keepPanelRef.current = true;
    const bounds = unionRects(next.map(strokeBounds));
    setSelection({ ids: replaceIds(selection.ids, targets, next), bounds: bounds ?? selection.bounds });
  };
  const selectedPens = selection ? page.strokes.filter((s) => selection.ids.has(s.id) && s.tool === 'pen') : [];
  const selectedLine = selectedPens.length === 1 && editShape && !editShape.shape.closed ? selectedPens[0] : undefined;
  const [lineWidth, setLineWidth] = useState(2);
  useEffect(() => {
    if (selectedPens[0]) setLineWidth(selectedPens[0].size);
  }, [selectedPens[0]?.size]);

  /** Replaces the selected items with changed copies (one undo step) and keeps them selected. */
  const replaceSelected = (targets: Stroke[], next: Stroke[], keepSelected = true) => {
    if (!next.length) return;
    hiddenRef.current = new Set(targets.map((s) => s.id));
    paintInk(true);
    paintNow(next);
    onChange(page.id, next, targets.map((s) => s.id));
    keepPanelRef.current = true;
    if (!keepSelected) {
      setSelection(null);
      return;
    }
    const bounds = unionRects(next.map(strokeBounds));
    if (bounds) setSelection({ ids: new Set(next.map((s) => s.id)), bounds });
  };
  const alignSelection = (mode: AlignMode) => {
    const targets = selectedStrokes();
    const { before, after } = alignStrokes(targets, mode);
    replaceSelectedPartial(targets, before, after);
  };
  const distributeSelection = (axis: 'horizontal' | 'vertical') => {
    const targets = selectedStrokes();
    const { before, after } = distributeStrokes(targets, axis);
    replaceSelectedPartial(targets, before, after);
  };
  /** Like replaceSelected when only some of the selected items changed. */
  const replaceSelectedPartial = (all: Stroke[], changed: Stroke[], next: Stroke[]) => {
    if (!next.length) return;
    hiddenRef.current = new Set(changed.map((s) => s.id));
    paintInk(true);
    paintNow(next);
    onChange(page.id, next, changed.map((s) => s.id));
    keepPanelRef.current = true;
    const kept = all.filter((s) => !changed.includes(s));
    const items = [...kept, ...next];
    const bounds = unionRects(items.map(strokeBounds));
    if (bounds) setSelection({ ids: new Set(items.map((s) => s.id)), bounds });
  };
  const flipSelection = (axis: 'horizontal' | 'vertical') => {
    const targets = selectedStrokes();
    replaceSelected(targets, flipStrokes(targets, axis));
  };
  const selectedGroups = new Set(selectedStrokes().map((s) => s.group).filter(Boolean));
  const canGroup = !!selection && selection.ids.size > 1 && !(selectedGroups.size === 1 && selectedStrokes().every((s) => s.group));
  const groupSelection = () => {
    const targets = selectedStrokes();
    replaceSelected(targets, regroup(targets, newId()));
  };
  const ungroupSelection = () => {
    const targets = selectedStrokes();
    replaceSelected(targets, regroup(targets, null));
  };
  const lockSelection = () => {
    const targets = selectedStrokes();
    replaceSelected(targets, setLocked(targets, true), false);
  };
  /** Unlocks a locked item (and the rest of its group) and selects it. */
  const unlockItem = (id: string) => {
    const item = page.strokes.find((s) => s.id === id);
    if (!item) return;
    const targets = page.strokes.filter((s) => s.id === id || (item.group && s.group === item.group && s.locked));
    const next = setLocked(targets, false);
    onChange(page.id, next, targets.map((s) => s.id));
    const bounds = unionRects(next.map(strokeBounds));
    if (bounds) setSelection({ ids: new Set(next.map((s) => s.id)), bounds });
    onRequestSelect?.();
  };
  const selectAllOnPage = () => {
    const ids = page.strokes.filter(isSelectable).map((s) => s.id);
    if (ids.length) {
      selectIds(ids);
      onRequestSelect?.();
    }
  };
  /** Puts a picture of the selection on the clipboard (or the share sheet). */
  /** Reads the selected handwriting with Google Drive and copies it (plus any typed text). */
  const [copyingText, setCopyingText] = useState(false);
  const copySelectionAsText = async () => {
    const strokes = selectedStrokes();
    // Typed text boxes, plus the PDF text under the selection.
    const pdfUnder = pdfRuns.length && selection ? textInRect(pdfRuns, selection.bounds) : '';
    const typed = [typedTextOf(strokes), pdfUnder].filter(Boolean).join('\n');
    let text = typed;
    if (handwriting(strokes).length) {
      const token = getToken();
      if (!token || !navigator.onLine) {
        alert('Reading handwriting requires an internet connection and Google Drive. Connect Google Drive from the account menu, then try again.');
        return;
      }
      setCopyingText(true);
      try {
        const image = await inkImage(strokes, 1);
        const read = image ? await new DriveClient(token).readTextFromImage(image, recognitionLanguage()) : '';
        text = [read, typed].filter(Boolean).join('\n');
      } catch {
        alert('The handwriting could not be read. Check the connection and try again.');
        return;
      } finally {
        setCopyingText(false);
      }
    }
    if (!text) {
      alert('No text was found in the selection.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      prompt('Copy this text:', text);
    }
    setMenuPanel(null);
  };

  const copySelectionAsImage = async () => {
    const strokes = selectedStrokes();
    const b = unionRects(strokes.map(strokeBounds));
    if (!b) return;
    const k = 3;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(b.width * k));
    canvas.height = Math.max(1, Math.ceil(b.height * k));
    const ctx = canvas.getContext('2d')!;
    await preloadImages(strokes);
    drawPage(ctx, strokes, { x: b.x, y: b.y, width: b.width, height: b.height, k });
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch {
      await shareOrDownload(blob, 'Selection.png');
    }
    setMenuPanel(null);
  };

  // Keyboard (Magic Keyboard / Smart Keyboard): arrows nudge, Delete removes, Esc deselects.
  const keyActionsRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyActionsRef.current = (e: KeyboardEvent) => {
    if (!selection || (e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
    const step = e.shiftKey ? 10 : 1;
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (move[e.key]) {
      e.preventDefault();
      const [dx, dy] = move[e.key]!;
      const targets = selectedStrokes();
      replaceSelected(targets, targets.map((s) => ({ ...translateStroke(s, dx, dy, newId()), createdAt: s.createdAt })));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelection();
    } else if (e.key === 'Escape') setSelection(null);
  };
  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => keyActionsRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [!!selection]);

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
      className={`ink-page${dark ? ' night' : ''}${invertPdf ? ' invert-pdf' : ''}`}
      data-page-width={page.width}
      style={{ width: cssWidth, height: cssHeight, ...templateStyle(page.template, scale, dark, page) }}
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
          else if (dropped.files.length || dropped.urls.length) alert('This picture could not be added. Save it to Photos first, then drag it from there.');
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
          {canvasMenu.lockedId && (
            <button
              role="menuitem"
              onClick={() => {
                const id = canvasMenu.lockedId!;
                setCanvasMenu(null);
                unlockItem(id);
              }}
            >
              Unlock
            </button>
          )}
          {pdfRuns.length > 0 && lineAt(pdfRuns, canvasMenu.x, canvasMenu.y) && (
            <button
              role="menuitem"
              onClick={() => {
                const line = lineAt(pdfRuns, canvasMenu.x, canvasMenu.y)!;
                setCanvasMenu(null);
                void navigator.clipboard.writeText(line).catch(() => prompt('Copy this text:', line));
              }}
            >
              Copy line
            </button>
          )}
          {pdfRuns.length > 0 && (
            <button
              role="menuitem"
              onClick={() => {
                const all = pageTextFromRuns(pdfRuns);
                setCanvasMenu(null);
                void navigator.clipboard.writeText(all).catch(() => prompt('Copy this text:', all));
              }}
            >
              Copy page text
            </button>
          )}
          <button role="menuitem" onClick={() => void paste(canvasMenu)}>
            Paste{clipKind === 'ink' ? '' : ' picture'}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setCanvasMenu(null);
              selectAllOnPage();
            }}
          >
            Select all
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
            <button className="sel-btn" aria-label="Link" onClick={() => setLinking(true)}>
              <LinkGlyph />
              <span className="sel-label">Link</span>
            </button>
            {singleText && (
              <button className="sel-btn" aria-label="Edit text" onClick={editSelectedText}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5V5h14v1.5M12 5v14M9 19h6" /></svg>
                <span className="sel-label">Edit</span>
              </button>
            )}
            {selectedPens.length > 0 && (
              <button
                className={`sel-btn${menuPanel === 'style' ? ' open' : ''}`}
                aria-label="Line style"
                aria-expanded={menuPanel === 'style'}
                onClick={() => setMenuPanel((p) => (p === 'style' ? null : 'style'))}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16" /><path d="M4 12h3M10.5 12h3M17 12h3" /><path d="M4.5 17h.01M8.5 17h.01M12.5 17h.01M16.5 17h.01M20 17h.01" strokeWidth="2.6" /></svg>
                <span className="sel-label">Style</span>
              </button>
            )}
            {canFill && (
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
            <button className="sel-btn" aria-label="Lock" title="Lock to prevent selecting or moving" onClick={lockSelection}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 10.5h11a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19v-7a1.5 1.5 0 0 1 1.5-1.5zM8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" /></svg>
              <span className="sel-label">Lock</span>
            </button>
            <button className="sel-btn danger" aria-label="Delete" onClick={deleteSelection}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" /></svg>
              <span className="sel-label">Delete</span>
            </button>
            {menuPanel === 'arrange' && (
              <div className="sel-panel sel-arrange" role="group" aria-label="Arrange">
                <div className="sel-section">Layer</div>
                <div className="sel-grid four">
                  <button onClick={() => arrangeSelection('front')}>To front</button>
                  <button onClick={() => arrangeSelection('forward')}>Forward</button>
                  <button onClick={() => arrangeSelection('backward')}>Backward</button>
                  <button onClick={() => arrangeSelection('back')}>To back</button>
                </div>
                {selection.ids.size > 1 && (
                  <>
                    <div className="sel-section">Align</div>
                    <div className="sel-grid six">
                      {(
                        [
                          ['left', 'M5 4v16M8 8h10M8 15h6'],
                          ['center', 'M12 4v16M6 8h12M8 15h8'],
                          ['right', 'M19 4v16M6 8h10M10 15h6'],
                          ['top', 'M4 5h16M8 8v10M15 8v6'],
                          ['middle', 'M4 12h16M8 6v12M15 8v8'],
                          ['bottom', 'M4 19h16M8 6v10M15 10v6'],
                        ] as [AlignMode, string][]
                      ).map(([mode, d]) => (
                        <button key={mode} aria-label={`Align ${mode}`} title={`Align ${mode}`} onClick={() => alignSelection(mode)}>
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {selection.ids.size > 2 && (
                  <div className="sel-grid two">
                    <button onClick={() => distributeSelection('horizontal')}>Space across</button>
                    <button onClick={() => distributeSelection('vertical')}>Space down</button>
                  </div>
                )}
                <div className="sel-section">Transform</div>
                <div className="sel-grid two">
                  <button onClick={() => flipSelection('horizontal')}>Flip horizontal</button>
                  <button onClick={() => flipSelection('vertical')}>Flip vertical</button>
                  {canGroup && <button onClick={groupSelection}>Group</button>}
                  {selectedGroups.size > 0 && <button onClick={ungroupSelection}>Ungroup</button>}
                </div>
                <button
                  className="sel-toggle"
                  role="switch"
                  aria-checked={keepAspect}
                  onClick={() => {
                    setKeepAspect(!keepAspect);
                    setKeepAspectState(!keepAspect);
                  }}
                >
                  <span>Keep proportions when resizing</span>
                  <span className={`switch ${keepAspect ? 'on' : ''}`} />
                </button>
                <button onClick={() => void copySelectionAsImage()}>Copy as image</button>
                <button disabled={copyingText} onClick={() => void copySelectionAsText()}>{copyingText ? 'Reading handwriting…' : 'Copy as text'}</button>
              </div>
            )}
            {menuPanel === 'style' && selectedPens.length > 0 && (
              <div className="sel-panel sel-style" role="group" aria-label="Line style">
                <div className="segmented compact">
                  {([null, 'dashed', 'dotted'] as const).map((d) => (
                    <button
                      key={d ?? 'solid'}
                      className={(selectedPens[0]!.dash ?? null) === d ? 'on' : ''}
                      onClick={() => restyleSelection({ dash: d })}
                      aria-label={d ?? 'Solid'}
                    >
                      <DashSample dash={d} />
                      <span>{d === 'dashed' ? 'Dashed' : d === 'dotted' ? 'Dotted' : 'Solid'}</span>
                    </button>
                  ))}
                </div>
                {selectedLine && (
                  <div className="segmented compact">
                    <button className={selectedLine.arrowStart ? 'on' : ''} onClick={() => restyleSelection({ arrowStart: !selectedLine.arrowStart })}>
                      <svg viewBox="0 0 32 12" aria-hidden="true"><path d="M3 6h26M9 1.5 3 6l6 4.5" /></svg>
                      <span>Start arrow</span>
                    </button>
                    <button className={selectedLine.arrowEnd ? 'on' : ''} onClick={() => restyleSelection({ arrowEnd: !selectedLine.arrowEnd })}>
                      <svg viewBox="0 0 32 12" aria-hidden="true"><path d="M3 6h26M23 1.5 29 6l-6 4.5" /></svg>
                      <span>End arrow</span>
                    </button>
                  </div>
                )}
                <label className="sel-opacity">
                  <span>Width</span>
                  <Slider
                    value={lineWidth}
                    min={SHAPE_SIZE_RANGE.min}
                    max={SHAPE_SIZE_RANGE.max}
                    step={SHAPE_SIZE_RANGE.step}
                    label="Line width"
                    onInput={setLineWidth}
                    onCommit={(v) => {
                      if (Math.abs(v - (selectedPens[0]?.size ?? v)) > 0.01) restyleSelection({ size: v });
                    }}
                  />
                  <span className="sel-value">{lineWidth.toFixed(1)}</span>
                </label>
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
                  <label className="sel-color custom" aria-label="Custom colour">
                    <input type="color" value={selectedColor} onChange={(e) => recolorSelection(e.target.value)} />
                  </label>
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
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.05-4.95M19 4.5V8h-3.5" /></svg>
            </div>
          )}
        </div>
      )}
      <div ref={badgeRef} className="gesture-badge" aria-hidden="true" />
      {page.strokes.map((s) => {
        if (!s.link || hiddenRef.current.has(s.id)) return null;
        const b = strokeBounds(s);
        return (
          <button
            key={`link-${s.id}`}
            className="link-badge"
            style={{ left: (b.x + b.width) * scale, top: b.y * scale }}
            aria-label={`Open link: ${describeLink(s.link)}`}
            title={describeLink(s.link)}
            onClick={() => followLink(s.link!)}
          >
            <LinkGlyph />
          </button>
        );
      })}
      {linking && selection && (
        <LinkDialog
          notebookId={page.notebookId}
          link={selectedStrokes().find((s) => s.link)?.link ?? null}
          onSave={(link) => {
            const targets = selectedStrokes();
            replaceSelected(
              targets,
              targets.map((s) => {
                const { link: _old, ...rest } = s;
                return link ? { ...rest, id: newId(), link } : { ...rest, id: newId() };
              }),
            );
          }}
          onClose={() => setLinking(false)}
        />
      )}
      <div
        ref={textEditorRef}
        className={`text-editor${textEdit ? ' open' : ''}`}
        style={
          textEdit
            ? { left: textEdit.at.x * scale, top: textEdit.at.y * scale, width: textEdit.width * textEdit.factor * scale }
            : undefined
        }
      >
        {textEdit && (
          <div ref={formatBarRef} className="text-format" role="toolbar" aria-label="Text formatting" onPointerDown={(e) => e.preventDefault()}>
            <select
              aria-label="Font"
              value={textEdit.style.font}
              onChange={(e) => patchDraft({ font: e.target.value as TextDraft['style']['font'] })}
            >
              {TEXT_FONT_ORDER.map((f) => (
                <option key={f} value={f}>
                  {TEXT_FONTS[f].label}
                </option>
              ))}
            </select>
            <div className="stepper" aria-label="Text size">
              <button aria-label="Smaller" onClick={() => patchDraft({ size: Math.max(8, textEdit.style.size - 2) })}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" /></svg>
              </button>
              <span>{textEdit.style.size}</span>
              <button aria-label="Larger" onClick={() => patchDraft({ size: Math.min(120, textEdit.style.size + 2) })}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12M12 6v12" /></svg>
              </button>
            </div>
            <span className="fmt-divider" />
            <button className={`fmt${textEdit.style.bold ? ' on' : ''}`} aria-label="Bold" onClick={() => patchDraft({ bold: !textEdit.style.bold })}>
              <b>B</b>
            </button>
            <button className={`fmt${textEdit.style.italic ? ' on' : ''}`} aria-label="Italic" onClick={() => patchDraft({ italic: !textEdit.style.italic })}>
              <i>I</i>
            </button>
            <button
              className={`fmt${textEdit.style.underline ? ' on' : ''}`}
              aria-label="Underline"
              onClick={() => patchDraft({ underline: !textEdit.style.underline })}
            >
              <u>U</u>
            </button>
            <span className="fmt-divider" />
            {(['left', 'center', 'right'] as const).map((a) => (
              <button key={a} className={`fmt${textEdit.style.align === a ? ' on' : ''}`} aria-label={`Align ${a}`} onClick={() => patchDraft({ align: a })}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={a === 'left' ? 'M4 6h16M4 10h10M4 14h16M4 18h10' : a === 'center' ? 'M4 6h16M7 10h10M4 14h16M7 18h10' : 'M4 6h16M10 10h10M4 14h16M10 18h10'} />
                </svg>
              </button>
            ))}
            <span className="fmt-divider" />
            {PEN_COLORS.slice(0, 6).map((c) => (
              <button
                key={c}
                className={`fmt-color${textEdit.color === c ? ' on' : ''}`}
                style={{ background: c }}
                aria-label={`Text colour ${c}`}
                onClick={() => patchDraft({ color: c })}
              />
            ))}
            <label className="fmt-color custom" aria-label="Custom text colour">
              <input type="color" value={textEdit.color} onChange={(e) => patchDraft({ color: e.target.value })} />
            </label>
            <button
              className={`fmt${textEdit.style.background ? ' on' : ''}`}
              aria-label="Highlight behind text"
              title="Background"
              onClick={() => patchDraft({ background: textEdit.style.background ? null : '#fff3b0' })}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5" fill="currentColor" fillOpacity="0.18" /><path d="M8 15.5 12 8l4 7.5M9.5 13h5" /></svg>
            </button>
            <button className="fmt done" onClick={() => commitText()}>
              Done
            </button>
          </div>
        )}
        <textarea
          ref={textAreaRef}
          className="textbox-input"
          aria-label="Text"
          spellCheck
          value={textEdit?.content ?? ''}
          placeholder={textEdit ? 'Type here' : undefined}
          onChange={(e) => {
            const content = e.target.value;
            setTextEdit((d) => (d ? { ...d, content } : d));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') commitText();
          }}
          style={
            textEdit
              ? {
                  fontFamily: TEXT_FONTS[textEdit.style.font].css,
                  fontSize: textEdit.style.size * textEdit.factor * scale,
                  fontWeight: textEdit.style.bold ? 700 : 400,
                  fontStyle: textEdit.style.italic ? 'italic' : 'normal',
                  color: displayColor(textEdit.color),
                  textAlign: textEdit.style.align,
                  textDecoration: textEdit.style.underline ? 'underline' : undefined,
                  padding: `${Math.max(2, textEdit.style.size * 0.3) * textEdit.factor * scale}px`,
                  lineHeight: 1.3,
                  background: textEdit.style.background ? displayColor(textEdit.style.background) : undefined,
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
