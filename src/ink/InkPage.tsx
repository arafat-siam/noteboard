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
  points: number[];
  hasPressure: boolean;
  predicted: number[];
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
const MAX_CANVAS_SIDE = 4096;

/** Shared across pages: while the Pencil is in use, finger/palm contacts never draw. */
let lastPenActivity = 0;

export function InkPage({ page, scale, settings, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const hiddenRef = useRef<Set<string>>(new Set());
  const frameRef = useRef<number | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);

  const cssWidth = page.width * scale;
  const cssHeight = page.height * scale;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const pixelScale = Math.min(scale * dpr, MAX_CANVAS_SIDE / page.height, MAX_CANVAS_SIDE / page.width);
  const pixelWidth = Math.round(page.width * pixelScale);
  const pixelHeight = Math.round(page.height * pixelScale);

  // Only pages near the viewport keep canvases alive (iPad Safari has a tight canvas memory budget).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setNearViewport(!!entry?.isIntersecting), {
      rootMargin: '150% 0px',
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const redrawInk = useCallback(() => {
    const ctx = inkRef.current?.getContext('2d');
    if (ctx) drawPage(ctx, page.strokes, pixelScale, hiddenRef.current);
  }, [page.strokes, pixelScale]);

  useEffect(() => {
    if (!gestureRef.current) hiddenRef.current = new Set();
    redrawInk();
  }, [redrawInk, nearViewport]);

  // Release canvas memory when scrolled away.
  useEffect(() => {
    if (nearViewport) return;
    for (const c of [inkRef.current, liveRef.current]) if (c) c.width = c.height = 0;
  }, [nearViewport]);

  useEffect(() => {
    if (settings.tool !== 'lasso') setSelection(null);
  }, [settings.tool]);

  useEffect(() => {
    setSelection((sel) => {
      if (!sel) return sel;
      const present = page.strokes.filter((s) => sel.ids.has(s.id));
      return present.length ? sel : null;
    });
  }, [page.strokes]);

  const toPage = (e: { clientX: number; clientY: number }): Point => {
    const rect = liveRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };

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

  const renderLive = () => {
    frameRef.current = null;
    const g = gestureRef.current;
    const ctx = liveRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!g) return;
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);

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
          g.snapped = true;
        } else {
          g.holdSince = Infinity; // don't retry on every frame
        }
      }
      drawStroke(ctx, liveStroke(g, true), true);
    } else if (g.kind === 'lasso' && g.lasso.length > 1) {
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
    // Keep animating while drawing so hold-to-snap can fire without movement.
    if (g.kind === 'ink') requestRender();
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
    if (changed) redrawInk();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const native = e.nativeEvent;
    if (e.pointerType === 'pen') lastPenActivity = Date.now();
    if (e.pointerType === 'touch' && (!settings.fingerDraws || Date.now() - lastPenActivity < 1500)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (gestureRef.current) return;
    e.preventDefault();
    try {
      liveRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // Capture is an optimisation (keeps strokes going past the page edge); never let it block ink.
    }

    const p = toPage(e);
    const g: Gesture = {
      pointerId: e.pointerId,
      kind: 'ink',
      points: [p.x, p.y, pressureOf(native)],
      hasPressure: e.pointerType === 'pen',
      predicted: [],
      holdAnchor: p,
      holdSince: Date.now(),
      snapped: false,
      erased: new Set(),
      lasso: [p],
      moveStart: p,
      offset: { x: 0, y: 0 },
    };

    if (settings.tool === 'lasso') {
      if (selection && rectContains(selection.bounds, p)) {
        g.kind = 'move';
        for (const id of selection.ids) hiddenRef.current.add(id);
        redrawInk();
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
    if (!g || g.pointerId !== e.pointerId) return;
    if (e.pointerType === 'pen') lastPenActivity = Date.now();
    const native = e.nativeEvent;
    // Coalesced events carry every digitizer sample between frames — the key to precise ink.
    const samples = native.getCoalescedEvents?.() ?? [];
    const events = samples.length ? samples : [native];

    for (const ev of events) {
      const p = toPage(ev);
      switch (g.kind) {
        case 'ink':
          if (g.snapped) break;
          g.points.push(p.x, p.y, pressureOf(ev));
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
    if (g.kind === 'ink') {
      const predicted = native.getPredictedEvents?.() ?? [];
      g.predicted = predicted.flatMap((ev) => {
        const p = toPage(ev);
        return [p.x, p.y, pressureOf(ev)];
      });
    }
    requestRender();
  };

  const finish = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gestureRef.current = null;

    if (!cancelled) {
      switch (g.kind) {
        case 'ink': {
          if (g.points.length === 3) g.points.push(g.points[0]! + 0.1, g.points[1]! + 0.1, g.points[2]!); // a dot
          const stroke = { ...liveStroke(g, false), id: newId() };
          const ctx = inkRef.current?.getContext('2d');
          if (ctx) {
            ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
            drawStroke(ctx, stroke); // show immediately; the saved page redraws identically
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
            redrawInk();
            break;
          }
          const moved = page.strokes.filter((s) => selection.ids.has(s.id)).map((s) => translateStroke(s, dx, dy, newId()));
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
      redrawInk();
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
    setSelection({ ids: new Set(copies.map((s) => s.id)), bounds: { ...b, x: b.x - 4, y: b.y - 4, width: b.width + 8, height: b.height + 8 } });
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
            style={{ width: cssWidth, height: cssHeight, touchAction: settings.fingerDraws ? 'none' : 'pan-x pan-y' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => finish(e, false)}
            onPointerCancel={(e) => finish(e, true)}
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
