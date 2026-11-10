import { useCallback, useEffect, useRef, useState } from 'react';
import { newId, type Page, type Stroke } from '../model/types';
import { drawPage, drawStroke } from './render';
import { recognizeShape } from './shapes';
import {
  boundsOf,
  rectContains,
  strokeBounds,
  strokeHit,
  strokeInLasso,
  strokePoints,
  translateStroke,
  unionRects,
  type Point,
  type Rect,
} from './geometry';
import { templateStyle } from './templates';
import { notePen } from './penState';
import { diagnostics, recordEvent, recordFrame } from './diagnostics';

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
}

interface Props {
  page: Page;
  /** CSS pixels per page unit. */
  scale: number;
  settings: ToolSettings;
  onChange: (pageId: string, added: Stroke[], removedIds: string[]) => void;
}

interface Gesture {
  pointerId: number;
  kind: 'ink' | 'erase' | 'lasso' | 'move';
  /** Canvas position at gesture start; reading layout on every sample would stall the pen. */
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
}

interface Selection {
  ids: Set<string>;
  bounds: Rect;
}

const HOLD_TO_SNAP_MS = 500;
/** iPad Safari refuses canvases above ~16.7M pixels; stay well under. */
const MAX_CANVAS_PIXELS = 12_000_000;

function getLiveContext(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  // `desynchronized` lets browsers that support it skip the compositor for lower latency.
  return canvas?.getContext('2d', { desynchronized: true }) as CanvasRenderingContext2D | null;
}

export function InkPage({ page, scale, settings, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const hiddenRef = useRef<Set<string>>(new Set());
  const frameRef = useRef<number | null>(null);
  /** What is currently painted on the ink canvas, to avoid needless full redraws. */
  const paintedRef = useRef<{ canvas: HTMLCanvasElement | null; scale: number; ids: Set<string> }>({
    canvas: null,
    scale: 0,
    ids: new Set(),
  });
  const [nearViewport, setNearViewport] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);

  const cssWidth = page.width * scale;
  const cssHeight = page.height * scale;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const pixelScale = Math.min(scale * dpr, Math.sqrt(MAX_CANVAS_PIXELS / (page.width * page.height)));
  const pixelWidth = Math.round(page.width * pixelScale);
  const pixelHeight = Math.round(page.height * pixelScale);
  diagnostics.devicePixelRatio = dpr;

  // Only pages near the viewport keep canvases alive (iPad Safari has a tight canvas memory budget).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setNearViewport(!!entry?.isIntersecting), {
      rootMargin: '60% 0px',
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const redrawInk = useCallback(
    (force = false) => {
      const canvas = inkRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const painted = paintedRef.current;
      const hidden = hiddenRef.current;
      // Fast path: after a stroke is committed we already painted it, so the saved page
      // coming back from the database needs no repaint.
      const unchanged =
        !force &&
        painted.canvas === canvas &&
        painted.scale === pixelScale &&
        hidden.size === 0 &&
        painted.ids.size === page.strokes.length &&
        page.strokes.every((s) => painted.ids.has(s.id));
      if (unchanged) return;
      drawPage(ctx, page.strokes, pixelScale, hidden);
      paintedRef.current = {
        canvas,
        scale: pixelScale,
        ids: new Set(page.strokes.filter((s) => !hidden.has(s.id)).map((s) => s.id)),
      };
      if (hidden.size) paintedRef.current.ids = new Set(); // force a full repaint once hidden strokes return
      diagnostics.canvasPixels = canvas.width * canvas.height;
    },
    [page.strokes, pixelScale],
  );

  useEffect(() => {
    if (!gestureRef.current && hiddenRef.current.size) {
      hiddenRef.current = new Set();
      redrawInk(true);
    } else {
      redrawInk();
    }
  }, [redrawInk, nearViewport]);

  // Release canvas memory when scrolled away.
  useEffect(() => {
    if (nearViewport) return;
    for (const c of [inkRef.current, liveRef.current]) if (c) c.width = c.height = 0;
    paintedRef.current = { canvas: null, scale: 0, ids: new Set() };
  }, [nearViewport]);

  useEffect(() => {
    if (settings.tool !== 'lasso') setSelection(null);
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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!area) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }
    ctx.clearRect(
      Math.floor(area.x * pixelScale) - 2,
      Math.floor(area.y * pixelScale) - 2,
      Math.ceil(area.width * pixelScale) + 4,
      Math.ceil(area.height * pixelScale) + 4,
    );
  };

  const renderLive = () => {
    frameRef.current = null;
    const g = gestureRef.current;
    const ctx = getLiveContext(liveRef.current);
    if (!ctx) return;
    if (!g) {
      clearLive(ctx, null);
      return;
    }

    if (g.kind === 'ink') {
      if (settings.shapeSnap && !g.snapped && Date.now() - g.holdSince > HOLD_TO_SNAP_MS && g.points.length > 24) {
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
          g.needsDraw = true;
        } else {
          g.holdSince = Infinity; // don't retry on every frame
        }
      }
      if (g.needsDraw) {
        const start = performance.now();
        clearLive(ctx, g.dirty);
        ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
        drawStroke(ctx, liveStroke(g, true), true);
        g.needsDraw = false;
        if (diagnostics.enabled) recordFrame(performance.now() - start, performance.now() - g.lastSampleAt);
      }
      // Keep ticking while the pen is down so hold-to-snap fires even without movement.
      requestRender();
      return;
    }

    clearLive(ctx, null);
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
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
    }
  };

  const requestRender = () => {
    if (frameRef.current == null) frameRef.current = requestAnimationFrame(renderLive);
  };

  const eraseAt = (g: Gesture, p: Point) => {
    const radius = settings.eraserSize / 2;
    let changed = false;
    for (const s of page.strokes) {
      if (!g.erased.has(s.id) && strokeHit(s, p, radius)) {
        g.erased.add(s.id);
        hiddenRef.current.add(s.id);
        changed = true;
      }
    }
    if (changed) redrawInk(true);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const native = e.nativeEvent;
    if (diagnostics.enabled) {
      diagnostics.pointerType = e.pointerType;
      diagnostics.coalescedSupported = typeof native.getCoalescedEvents === 'function';
      diagnostics.predictedSupported = typeof native.getPredictedEvents === 'function';
    }
    if (e.pointerType === 'pen') notePen(true);
    // Fingers scroll/zoom (handled by the editor) unless finger drawing is on.
    if (e.pointerType === 'touch' && !settings.fingerDraws) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (gestureRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      liveRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // Capture is an optimisation (keeps strokes going past the page edge); never let it block ink.
    }

    const rect = liveRef.current!.getBoundingClientRect();
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
    };
    growDirty(g, p.x, p.y);

    if (settings.tool === 'lasso') {
      if (selection && rectContains(selection.bounds, p)) {
        g.kind = 'move';
        for (const id of selection.ids) hiddenRef.current.add(id);
        redrawInk(true);
      } else {
        setSelection(null);
        g.kind = 'lasso';
      }
    } else if (settings.tool === 'eraser') {
      g.kind = 'erase';
      eraseAt(g, p);
    }
    gestureRef.current = g;
    requestRender();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gestureRef.current;
    if (e.pointerType === 'pen') notePen();
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
          if (g.snapped) break;
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
      }
    }
    if (g.kind === 'ink' && !g.snapped) {
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

  const finish = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
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
          if (ctx) {
            ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
            drawStroke(ctx, stroke); // show immediately; the saved page won't need a repaint
            paintedRef.current.ids.add(stroke.id);
          }
          onChange(page.id, [stroke], []);
          break;
        }
        case 'erase':
          if (g.erased.size) onChange(page.id, [], [...g.erased]);
          break;
        case 'lasso': {
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
            redrawInk(true);
            break;
          }
          const moved = page.strokes
            .filter((s) => selection.ids.has(s.id))
            .map((s) => translateStroke(s, dx, dy, newId()));
          onChange(page.id, moved, [...selection.ids]);
          setSelection({
            ids: new Set(moved.map((s) => s.id)),
            bounds: { ...selection.bounds, x: selection.bounds.x + dx, y: selection.bounds.y + dy },
          });
          break;
        }
      }
    } else if (g.erased.size || g.kind === 'move') {
      hiddenRef.current = new Set();
      redrawInk(true);
    }
    requestRender(); // clears the live layer
  };

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
    >
      {nearViewport && (
        <>
          <canvas
            ref={inkRef}
            className="ink-layer"
            width={pixelWidth}
            height={pixelHeight}
            style={{ width: cssWidth, height: cssHeight }}
          />
          <canvas
            ref={liveRef}
            className="ink-layer ink-input"
            width={pixelWidth}
            height={pixelHeight}
            style={{ width: cssWidth, height: cssHeight }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => finish(e, false)}
            onPointerCancel={(e) => finish(e, true)}
            onContextMenu={(e) => e.preventDefault()}
          />
        </>
      )}
      {selection && (
        <div
          className="selection-box"
          style={{
            left: selection.bounds.x * scale,
            top: selection.bounds.y * scale,
            width: selection.bounds.width * scale,
            height: selection.bounds.height * scale,
          }}
        >
          <div className="selection-menu">
            <button onClick={duplicateSelection}>Duplicate</button>
            <button onClick={deleteSelection}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}
