import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { db } from '../db/db';
import { renameItem } from '../db/library';
import { addPage, applyStrokeChange, copyPagesTo, deletePage, loadPage, notebookPages, pastePages, setPageTemplate } from '../db/pages';
import { appendPdf } from '../pdf/pdf';
import { CopyPageDialog } from './CopyPageDialog';
import { ExportDialog } from './ExportDialog';
import { PageManager } from './PageManager';
import { deferPageLayout, isControl, PAGE_ACTION, relayoutPages, type PageAction } from '../ink/InkPage';
import { getClip, setClip } from '../ink/clipboard';
import { readDropped, resolveDropped } from '../ink/images';
import { exportNotebookPdf, exportPagePng, safeFilename, shareOrDownload } from '../export/exporters';
import type { ToolKind, ToolSettings } from '../ink/InkPage';
import { PageSlot } from './PageSlot';
import { TEMPLATE_LABELS } from '../ink/templates';
import { PAGE_WIDTH, newId, type Page, type PaperTemplate, type Stroke } from '../model/types';
import { onPencilGesture } from '../pencil/bridge';
import { penActiveWithin } from '../ink/penState';
import { diagnostics } from '../ink/diagnostics';
import { sync } from '../sync/instance';
import { Modal, PromptDialog } from './Dialogs';
import { SyncBadge } from './SyncBadge';
import { QuickPalette } from './QuickPalette';
import { ToolPalette, usePaletteLayout } from './ToolPalette';
import { Icon } from './Icon';
import { useAppIsDark } from './theme';
import { setInkDark } from '../ink/inkTheme';
import { setNotebookSettings } from '../db/library';
import { act } from './useLibrary';
import type { NotebookSettings } from '../model/types';
import { DEFAULT_POINTER, DEFAULT_SHAPE, DEFAULT_SLOTS, DEFAULT_TAPE, DEFAULT_TEXT, PEN_COLORS, type PenSlot } from '../ink/palette';
import { isBrushKind } from '../ink/brushes';
import { newId as makeId } from '../model/types';

/** Zoom range: 5 % (see a whole notebook at once) to 400 %. */
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;

interface Op {
  pageId: string;
  added: Stroke[];
  removed: Stroke[];
}


/** Puts a pen from the tray in hand: the drawing fields mirror the chosen slot. */
function withSlot(s: ToolSettings, id: string): ToolSettings {
  const slot = s.slots.find((x) => x.id === id) ?? s.slots[0];
  if (!slot) return s;
  return slot.kind === 'pen'
    ? { ...s, activeSlot: slot.id, tool: 'pen', color: slot.color, penSize: slot.size, penBrush: isBrushKind(slot.brush) ? slot.brush : 'fountain', penStyle: slot.penStyle }
    : { ...s, activeSlot: slot.id, tool: 'highlighter', highlighterColor: slot.color, highlighterSize: slot.size };
}

const ALL_TOOLS: ToolKind[] = ['pen', 'highlighter', 'eraser', 'lasso', 'laser', 'text', 'shape', 'tape'];
/** Tools kept in hand across launches (pens are restored from their slot). */
const STICKY_TOOLS: ToolKind[] = ['eraser', 'lasso', 'laser', 'text', 'shape', 'tape'];

const DEFAULT_SETTINGS: ToolSettings = withSlot(
  {
    tool: 'pen',
    color: PEN_COLORS[0]!,
    highlighterColor: '#ffe14d',
    penSize: 2.5,
    highlighterSize: 20,
    eraserSize: 18,
    penBrush: 'fountain',
    eraserMode: 'stroke',
    shapeSnap: true,
    fingerDraws: false,
    hoverPalette: true,
    slots: DEFAULT_SLOTS,
    activeSlot: DEFAULT_SLOTS[0]!.id,
    text: DEFAULT_TEXT,
    shape: DEFAULT_SHAPE,
    tape: DEFAULT_TAPE,
    pointer: DEFAULT_POINTER,
  },
  DEFAULT_SLOTS[0]!.id,
);

function loadSettings(): ToolSettings {
  try {
    const saved = JSON.parse(localStorage.getItem('noteboard.tools') ?? '{}') as Partial<ToolSettings>;
    const merged: ToolSettings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      // Settings saved by older versions lack the newer tools: fill in their defaults.
      text: { ...DEFAULT_TEXT, ...saved.text },
      shape: { ...DEFAULT_SHAPE, ...saved.shape },
      tape: { ...DEFAULT_TAPE, ...saved.tape },
      pointer: { ...DEFAULT_POINTER, ...saved.pointer },
    };
    if (!Array.isArray(saved.slots) || !saved.slots.length) merged.slots = DEFAULT_SLOTS;
    if (!ALL_TOOLS.includes(merged.tool)) merged.tool = 'pen';
    // Keep using the eraser/lasso/… if that was in hand; otherwise restore the pen in hand.
    return STICKY_TOOLS.includes(merged.tool)
      ? { ...withSlot(merged, merged.activeSlot), tool: merged.tool }
      : withSlot(merged, merged.activeSlot);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function NotebookEditor({ notebookId, onClose }: { notebookId: string; onClose: () => void }) {
  const notebook = useLiveQuery(() => db.items.get(notebookId), [notebookId]);
  // Only the notebook's page list is watched here; each page loads itself (see PageSlot).
  const pageIds = notebook?.kind === 'notebook' ? notebook.pageIds : [];
  const pagesById = useRef(new Map<string, Page>()).current;

  const [settings, setSettings] = useState<ToolSettings>(loadSettings);
  const [paletteLayout, setPaletteLayout] = usePaletteLayout();
  const appDark = useAppIsDark();
  // Leaving the editor: thumbnails and exports elsewhere draw in normal colours again.
  useEffect(() => () => void setInkDark(false), []);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const previousTool = useRef<ToolKind>('pen');
  const [undoStack, setUndoStack] = useState<Op[]>([]);
  const [redoStack, setRedoStack] = useState<Op[]>([]);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(800);
  const [renaming, setRenaming] = useState(false);
  const [pageMenu, setPageMenu] = useState<Page | null>(null);
  /** Page being copied to another notebook (the picker is open). */
  const [copyingPage, setCopyingPage] = useState<Page | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addingPdf, setAddingPdf] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const pictureInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(timer);
  }, [notice]);
  const [exportOpen, setExportOpen] = useState(false);
  /** The export dialog (with pages picked in the page manager, if any). */
  const [exporting, setExporting] = useState<{ picked?: string[] } | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(diagnostics.enabled);
  const [palette, setPalette] = useState<{ x: number; y: number } | null>(null);
  const openPalette = useCallback((x: number, y: number) => setPalette({ x, y }), []);
  const closePalette = useCallback(() => setPalette(null), []);
  const requestSelect = useCallback(() => setSettings((s) => (s.tool === 'lasso' ? s : { ...s, tool: 'lasso' })), []);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The scroll area only exists after the notebook has loaded, so effects must re-run when it
  // appears (a plain ref read on mount would be null and gestures would never attach).
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const attachScroll = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    setScrollEl(el);
  }, []);
  const pagesWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem('noteboard.tools', JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  const update = (patch: Partial<ToolSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const selectTool = useCallback((tool: ToolKind) => {
    if (tool === 'pen' || tool === 'highlighter') {
      setSettings((s) => withSlot(s, s.slots.find((x) => x.kind === tool)?.id ?? s.activeSlot));
      return;
    }
    setSettings((s) => ({ ...s, tool }));
  }, []);
  const selectSlot = useCallback((id: string) => setSettings((s) => withSlot(s, id)), []);
  const updateSlot = useCallback(
    (patch: Partial<PenSlot>) =>
      setSettings((s) => withSlot({ ...s, slots: s.slots.map((x) => (x.id === s.activeSlot ? { ...x, ...patch } : x)) }, s.activeSlot)),
    [],
  );
  const addSlot = useCallback(() => {
    // A new pen starts as a copy of the one in hand, ready for a different colour or size.
    const id = makeId();
    setSettings((s) => {
      const base = s.slots.find((x) => x.id === s.activeSlot) ?? DEFAULT_SLOTS[0]!;
      const index = s.slots.findIndex((x) => x.id === base.id);
      const slots = [...s.slots];
      slots.splice(index + 1, 0, { ...base, id });
      return withSlot({ ...s, slots }, id);
    });
  }, []);
  const removeSlot = useCallback((id: string) => {
    setSettings((s) => {
      if (s.slots.length <= 1) return s;
      const index = s.slots.findIndex((x) => x.id === id);
      const slots = s.slots.filter((x) => x.id !== id);
      const next = slots[Math.max(0, index - 1)]!;
      return withSlot({ ...s, slots }, next.id);
    });
  }, []);

  useLayoutEffect(() => {
    const el = scrollEl;
    if (!el) return;
    setContainerWidth(el.clientWidth || 800);
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry?.contentRect.width ?? 800));
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollEl]);

  const fitScale = Math.min((containerWidth - 32) / PAGE_WIDTH, 1.6);
  const scale = Math.max(0.01, fitScale * zoom);

  // ---- Editing & undo ----------------------------------------------------------------
  const apply = useCallback(async (op: Op): Promise<Op> => {
    await applyStrokeChange(db, op.pageId, op.added, op.removed.map((s) => s.id));
    sync.syncSoon();
    // Erased strokes come back as copies with new ids: the old ids are tombstoned for sync.
    const restored = op.removed.map((s) => ({ ...s, id: newId() }));
    return { pageId: op.pageId, added: restored, removed: op.added };
  }, []);

  // Stacks live in refs (side effects must never run inside React state updaters);
  // the state copies only drive the enabled/disabled buttons.
  const undoRef = useRef<Op[]>([]);
  const redoRef = useRef<Op[]>([]);
  const busy = useRef<Promise<unknown>>(Promise.resolve());
  const publish = () => {
    setUndoStack([...undoRef.current]);
    setRedoStack([...redoRef.current]);
  };

  const onChange = useCallback(
    (pageId: string, added: Stroke[], removedIds: string[]) => {
      const page = pagesById.get(pageId);
      const removed = page ? page.strokes.filter((s) => removedIds.includes(s.id)) : [];
      busy.current = busy.current.then(async () => {
        const inverse = await apply({ pageId, added, removed });
        undoRef.current = [...undoRef.current.slice(-199), inverse];
        redoRef.current = [];
        publish();
      });
    },
    [apply],
  );

  const step = useCallback(
    (from: React.MutableRefObject<Op[]>, to: React.MutableRefObject<Op[]>) => {
      // Serialised so rapid two-finger taps can't apply the same step twice.
      busy.current = busy.current.then(async () => {
        const op = from.current[from.current.length - 1];
        if (!op) return;
        from.current = from.current.slice(0, -1);
        to.current = [...to.current, await apply(op)];
        publish();
      });
    },
    [apply],
  );
  const undo = useCallback(() => step(undoRef, redoRef), [step]);
  const redo = useCallback(() => step(redoRef, undoRef), [step]);

  // ---- Keyboard, Pencil gestures --------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing into a text box, field or menu is not a shortcut.
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (!mod) {
        const map: Record<string, ToolKind> = { p: 'pen', h: 'highlighter', e: 'eraser', l: 'lasso', k: 'laser', t: 'text', s: 'shape', a: 'tape' };
        const tool = map[e.key.toLowerCase()];
        if (tool) selectTool(tool);
      }
    };
    window.addEventListener('keydown', onKey);
    // Pencil gestures forwarded by the Noteboard Shell app (web pages can't receive them).
    const offPencil = onPencilGesture(({ gesture, point }) => {
      if (gesture === 'doubleTap') {
        // Like Apple Notes: double-tap flips between the current tool and the eraser.
        const current = settingsRef.current.tool;
        if (current === 'eraser') {
          if (previousTool.current === 'lasso') selectTool('lasso');
          else selectSlot(settingsRef.current.activeSlot);
        } else {
          previousTool.current = current;
          selectTool('eraser');
        }
      } else {
        // Squeeze (Pencil Pro): open the quick palette right under the Pencil tip.
        setPalette(point ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      }
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      offPencil();
    };
  }, [undo, redo, selectTool, selectSlot]);

  // ---- Fingers: scroll with momentum, pinch to zoom, two/three-finger tap = undo/redo -------
  // The page area has `touch-action: none`, so Safari can never turn a Pencil stroke into a
  // scroll (which cancels or breaks strokes). Finger scrolling is implemented here instead.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  /** Scroll position to apply together with a pinch's new zoom (see the layout effect below). */
  /**
   * The spot between the fingers when a pinch ended: which page, where on it (0–1), and where
   * on screen. After re-rendering at the new zoom it's put back exactly there.
   */
  const pendingZoomScroll = useRef<{ page: number; u: number; v: number; x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const target = pendingZoomScroll.current;
    if (!target) return;
    pendingZoomScroll.current = null;
    // Same frame as the re-render at the new zoom: drop the temporary scale and scroll so the
    // same spot of the same page is under the fingers again — no jump, no shake.
    const wrap = pagesWrapRef.current;
    if (wrap) wrap.style.transform = wrap.style.willChange = '';
    const el = scrollRef.current;
    const pageEl = wrap?.querySelectorAll<HTMLElement>('.ink-page')[target.page];
    if (el && pageEl) {
      const r = pageEl.getBoundingClientRect();
      el.scrollLeft += r.left + target.u * r.width - target.x;
      el.scrollTop += r.top + target.v * r.height - target.y;
    }
    // Pages draw themselves at the new zoom now (once, at the final scroll position), before
    // this frame is painted.
    relayoutPages();
  }, [zoom]);
  useEffect(() => {
    const el = scrollEl;
    if (!el) return;
    const fingers = new Map<number, { x: number; y: number }>();
    let pan: { x: number; y: number; t: number; vx: number; vy: number; samples: { x: number; y: number; t: number }[] } | null = null;
    let pinch: { startDist: number; startZoom: number; current: number; midX: number; midY: number; origin: string } | null = null;
    let pinchFrame: number | null = null;
    /** Shows the pinch's current size: one cheap style change per drawn frame. */
    const showPinch = () => {
      if (pinchFrame != null) cancelAnimationFrame(pinchFrame);
      pinchFrame = null;
      const wrap = pagesWrapRef.current;
      if (!wrap || !pinch) return;
      wrap.style.transformOrigin = pinch.origin;
      wrap.style.transform = `scale(${pinch.current / pinch.startZoom})`;
    };
    const dropPinch = () => {
      if (pinchFrame != null) cancelAnimationFrame(pinchFrame);
      pinchFrame = null;
      pinch = null;
      const wrap = pagesWrapRef.current;
      if (wrap) wrap.style.transform = wrap.style.willChange = '';
    };
    let inertia: number | null = null;
    let tap: { fingers: number; start: number; travel: number } | null = null;
    // Where the view was when the current finger gesture began, so a palm that landed just
    // before the Pencil can be undone (it would otherwise zoom or scroll the page).
    let before: { zoom: number; left: number; top: number; at: number } | null = null;

    const stopInertia = () => {
      if (inertia != null) cancelAnimationFrame(inertia);
      inertia = null;
    };
    const pair = () => [...fingers.values()].slice(0, 2) as [{ x: number; y: number }, { x: number; y: number }];
    const fingerDistance = () => {
      const [a, b] = pair();
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const startPan = () => {
      const first = [...fingers.values()][0];
      const now = performance.now();
      pan = first ? { x: first.x, y: first.y, t: now, vx: 0, vy: 0, samples: [{ x: first.x, y: first.y, t: now }] } : null;
    };
    const startPinch = () => {
      const rect = el.getBoundingClientRect();
      const [a, b] = pair();
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;
      const wrap = pagesWrapRef.current;
      pinch = {
        startDist: Math.max(1, fingerDistance()),
        startZoom: zoomRef.current,
        current: zoomRef.current,
        midX,
        midY,
        // The spot between the fingers stays put (the view doesn't scroll during a pinch).
        origin: wrap ? `${midX + el.scrollLeft - wrap.offsetLeft}px ${midY + el.scrollTop - wrap.offsetTop}px` : '0 0',
      };
      // Its own layer for the pinch: resizing it is then pure compositing, with no repainting
      // of paper lines, shadows and labels on every frame.
      if (wrap) wrap.style.willChange = 'transform';
      pan = null;
    };
    const endPinch = () => {
      if (!pinch) return;
      const { current, startZoom, midX, midY } = pinch;
      const wrap = pagesWrapRef.current;
      if (Math.abs(current - startZoom) < 0.01) {
        dropPinch();
        return;
      }
      showPinch(); // the final size, in case a frame was still pending
      pinch = null;
      // Keep the spot between the fingers in place after re-rendering sharply at the new zoom.
      // The scale transform stays on until that re-render is laid out (layout effect above).
      const box = el.getBoundingClientRect();
      const x = box.left + midX;
      const y = box.top + midY;
      const pages = [...(wrap?.querySelectorAll<HTMLElement>('.ink-page') ?? [])];
      let page = -1;
      let best = Infinity;
      pages.forEach((p, i) => {
        const r = p.getBoundingClientRect();
        const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        if (d < best) {
          best = d;
          page = i;
        }
      });
      const r = pages[page]?.getBoundingClientRect();
      pendingZoomScroll.current = r
        ? { page, u: (x - r.left) / r.width, v: (y - r.top) / r.height, x, y }
        : null;
      if (r) deferPageLayout();
      else if (wrap) wrap.style.transform = wrap.style.willChange = '';
      setZoom(current);
    };

    const onDown = (e: PointerEvent) => {
      // Touching a menu or slider on the page is not a scroll or the palm.
      if (isControl(e.target)) return;
      if (e.pointerType === 'pen') {
        // The Pencil wins. Any finger gesture still going (or that started moments ago) was
        // the palm resting on the screen: cancel it and put the view back.
        const recent = before && (fingers.size > 0 || performance.now() - before.at < 1500);
        fingers.clear();
        pan = null;
        stopInertia();
        tap = null;
        if (pinch) dropPinch();
        if (recent && before) {
          if (Math.abs(zoomRef.current - before.zoom) > 0.001) setZoom(before.zoom);
          el.scrollLeft = before.left;
          el.scrollTop = before.top;
        }
        before = null;
        return;
      }
      // While writing (and for a moment after), touches are the palm: ignore them.
      if (e.pointerType !== 'touch' || penActiveWithin(1500)) return;
      stopInertia();
      if (fingers.size === 0) before = { zoom: zoomRef.current, left: el.scrollLeft, top: el.scrollTop, at: performance.now() };
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      tap = tap ? { ...tap, fingers: Math.max(tap.fingers, fingers.size) } : { fingers: 1, start: performance.now(), travel: 0 };
      if (fingers.size === 1) startPan();
      else if (fingers.size === 2) startPinch();
    };

    const onMove = (e: PointerEvent) => {
      const prev = fingers.get(e.pointerId);
      if (!prev) return;
      if (penActiveWithin(0)) {
        fingers.clear();
        pan = null;
        return;
      }
      const p = { x: e.clientX, y: e.clientY };
      fingers.set(e.pointerId, p);
      if (tap) tap.travel += Math.hypot(p.x - prev.x, p.y - prev.y);

      if (pinch && fingers.size >= 2) {
        pinch.current = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.startZoom * (fingerDistance() / pinch.startDist)));
        // Both fingers report every frame: apply once per frame, not once per finger.
        if (pinchFrame == null) pinchFrame = requestAnimationFrame(showPinch);
      } else if (pan) {
        const now = performance.now();
        const dx = p.x - pan.x;
        const dy = p.y - pan.y;
        el.scrollLeft -= dx;
        el.scrollTop -= dy;
        pan.x = p.x;
        pan.y = p.y;
        pan.t = now;
        // Release speed = movement over the last ~80 ms (steadier than the last sample alone).
        pan.samples.push({ x: p.x, y: p.y, t: now });
        while (pan.samples.length > 2 && now - pan.samples[0]!.t > 80) pan.samples.shift();
        const first = pan.samples[0]!;
        const span = Math.max(8, now - first.t);
        pan.vx = (p.x - first.x) / span;
        pan.vy = (p.y - first.y) / span;
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!fingers.has(e.pointerId)) return;
      fingers.delete(e.pointerId);
      if (pinch && fingers.size < 2) {
        endPinch();
        if (fingers.size === 1) startPan();
      } else if (fingers.size === 0 && pan) {
        // Momentum, like native scrolling.
        let { vx, vy } = pan;
        if (performance.now() - pan.t > 60) vx = vy = 0; // finger stopped before lifting
        pan = null;
        // Like iPad scrolling: glide out with a gentle, steady slow-down.
        const max = 6; // px per ms
        vx = Math.max(-max, Math.min(max, vx));
        vy = Math.max(-max, Math.min(max, vy));
        let last = performance.now();
        const step = (now: number) => {
          const dt = Math.min(34, now - last);
          last = now;
          const beforeLeft = el.scrollLeft;
          const beforeTop = el.scrollTop;
          el.scrollLeft -= vx * dt;
          el.scrollTop -= vy * dt;
          // Hit the top / bottom: stop instead of pushing against the edge.
          if (el.scrollTop === beforeTop) vy = 0;
          if (el.scrollLeft === beforeLeft) vx = 0;
          const decay = Math.pow(0.9975, dt);
          vx *= decay;
          vy *= decay;
          inertia = Math.hypot(vx, vy) > 0.012 ? requestAnimationFrame(step) : null;
        };
        if (Math.hypot(vx, vy) > 0.04) inertia = requestAnimationFrame(step);
      }
      if (fingers.size === 0 && tap) {
        if (tap.travel < 12 && performance.now() - tap.start < 300) {
          if (tap.fingers === 2) undo();
          else if (tap.fingers === 3) redo();
        }
        tap = null;
      }
    };

    // iPadOS Scribble (Pencil handwriting-to-text) holds back Pencil touches in web pages while
    // it decides whether you're writing into a text field. That delay is why the Pencil felt
    // laggier than a finger. Claiming the touch (preventDefault) opts this area out of Scribble.
    const claimTouch = (e: TouchEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.('button, input, select, textarea, a, label')) return;
      const stylus = [...e.changedTouches].some((t) => (t as Touch & { touchType?: string }).touchType === 'stylus');
      if (stylus || target instanceof HTMLCanvasElement) e.preventDefault();
    };
    el.addEventListener('touchstart', claimTouch, { passive: false });
    el.addEventListener('touchmove', claimTouch, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      stopInertia();
      if (pinchFrame != null) cancelAnimationFrame(pinchFrame);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('touchstart', claimTouch);
      el.removeEventListener('touchmove', claimTouch);
    };
  }, [undo, redo, scrollEl]);

  /** The page mostly on screen. */
  const visiblePageId = () => {
    const el = scrollRef.current;
    const slots = el ? [...el.querySelectorAll<HTMLElement>('.page-slot')] : [];
    if (!el || !slots.length) return pageIds[0];
    const middle = el.getBoundingClientRect().top + el.clientHeight / 2;
    let best = 0;
    slots.forEach((slot, i) => {
      if (slot.getBoundingClientRect().top <= middle) best = i;
    });
    return pageIds[Math.min(best, pageIds.length - 1)];
  };
  const pageAction = (detail: Omit<PageAction, 'pageId'>) => {
    const pageId = visiblePageId();
    if (pageId) window.dispatchEvent(new CustomEvent<PageAction>(PAGE_ACTION, { detail: { ...detail, pageId } }));
  };
  const pageActionRef = useRef(pageAction);
  pageActionRef.current = pageAction;

  // Paste from the keyboard (⌘V) or the iPad's paste menu: pictures from other apps, or
  // Noteboard's own copied ink, onto the page on screen.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;
      const dropped = readDropped(e.clipboardData);
      if (!dropped.files.length && !dropped.urls.length && getClip()?.kind !== 'ink') return;
      e.preventDefault();
      if (!dropped.files.length && dropped.urls.length) {
        void resolveDropped(dropped).then((files) => files.length && pageActionRef.current({ action: 'paste', files }));
        return;
      }
      pageActionRef.current({ action: 'paste', files: dropped.files });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const openPage = (pageId: string) => {
    setPagesOpen(false);
    requestAnimationFrame(() => {
      const index = pageIds.indexOf(pageId);
      const slot = scrollRef.current?.querySelectorAll<HTMLElement>('.page-slot')[index];
      slot?.scrollIntoView({ block: 'start' });
    });
  };

  if (notebook === undefined) return <div className="loading">Loading…</div>;
  if (!notebook || notebook.kind !== 'notebook' || notebook.deleted) {
    return (
      <div className="empty">
        This notebook is no longer available. <button onClick={onClose}>Back to library</button>
      </div>
    );
  }

  // Night mode: the notebook's own choice, or follow the app's appearance.
  const darkPages = notebook.pageTheme ? notebook.pageTheme === 'dark' : appDark;
  setInkDark(darkPages); // read while pages draw (idempotent)
  const setPageLook = (patch: NotebookSettings) => void act(() => setNotebookSettings(db, notebook.id, patch));

  const exportPdf = async () => {
    setExportOpen(false);
    await shareOrDownload(await exportNotebookPdf(notebook, await notebookPages(db, notebook.id)), `${safeFilename(notebook.name)}.pdf`);
  };

  const exportVisiblePagePng = async () => {
    setExportOpen(false);
    const el = scrollRef.current;
    const index = el ? Math.min(pageIds.length - 1, Math.floor(el.scrollTop / (notebookPageHeight(scale) + 24))) : 0;
    const pageId = pageIds[Math.max(0, index)];
    const page = pageId ? await loadPage(db, pageId) : undefined;
    if (page) await shareOrDownload(await exportPagePng(page), `${safeFilename(notebook.name)} p${index + 1}.png`);
  };

  return (
    <div className="editor">
      <header className="toolbar editor-top">
        <button className="back-button" onClick={onClose} aria-label="Back to library">
          <Icon name="chevronLeft" size={22} />
          <span>Library</span>
        </button>
        <button className="editor-title" onClick={() => setRenaming(true)} title="Rename">
          {notebook.name}
        </button>
        <span className="muted page-count">{pageIds.length} page{pageIds.length === 1 ? '' : 's'}</span>
        <div className="spacer" />
        <div className="zoom-controls" role="group" aria-label="Zoom">
          <button className="tool" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.25))}>
            <Icon name="minus" size={18} />
          </button>
          <button className="tool text" onClick={() => setZoom(1)} title="Reset zoom">
            {Math.round(zoom * 100)}%
          </button>
          <button className="tool" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.25))}>
            <Icon name="plus" size={18} />
          </button>
        </div>
        <SyncBadge compact />
        <button
          className={`tool icon-tool${darkPages ? ' on' : ''}`}
          aria-label={darkPages ? 'Light pages' : 'Night mode (dark pages)'}
          title={darkPages ? 'Light pages' : 'Night mode'}
          onClick={() => setPageLook({ pageTheme: darkPages ? 'light' : 'dark' })}
        >
          <Icon name={darkPages ? 'sun' : 'moon'} size={22} />
        </button>
        <button className="tool icon-tool" aria-label="Insert picture" title="Insert picture" onClick={() => pictureInputRef.current?.click()}>
          <Icon name="image" size={22} />
        </button>
        <button className="tool icon-tool" aria-label="Pages" title="Pages" onClick={() => setPagesOpen(true)}>
          <Icon name="pages" size={22} />
        </button>
        <button className="tool icon-tool" aria-label="Export and more" title="Export and more" onClick={() => setExportOpen(true)}>
          <Icon name="share" size={22} />
        </button>
        <input
          ref={pictureInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) pageAction({ action: 'insertPictures', files });
          }}
        />
      </header>

      <div className={`editor-body palette-${paletteLayout.style} palette-${paletteLayout.side}`}>
      <ToolPalette
        settings={settings}
        update={update}
        selectTool={selectTool}
        selectSlot={selectSlot}
        updateSlot={updateSlot}
        addSlot={addSlot}
        removeSlot={removeSlot}
        undo={undo}
        redo={redo}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        layout={paletteLayout}
        setLayout={setPaletteLayout}
      />

      <div
        className="pages-scroll"
        ref={attachScroll}
        // Pictures dropped beside or between pages go onto the page on screen.
        onDragEnter={(e) => e.preventDefault()}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          e.preventDefault();
          const dropped = readDropped(e.dataTransfer);
          void resolveDropped(dropped).then((files) => {
            if (files.length) pageAction({ action: 'insertPictures', files });
          });
        }}
      >
        <div className="pages" ref={pagesWrapRef}>
          {pageIds.map((pageId, index) => (
            <PageSlot
              key={pageId}
              pageId={pageId}
              index={index}
              total={pageIds.length}
              scale={scale}
              settings={settings}
              scroller={scrollEl}
              onChange={onChange}
              onHoverHold={openPalette}
              onRequestSelect={requestSelect}
              onPageMenu={setPageMenu}
              registry={pagesById}
              dark={darkPages}
              invertPdf={darkPages && !!notebook.invertPdf}
            />
          ))}
          <button
            className="add-page"
            onClick={() => {
              void addPage(db, notebook.id).then(() => sync.syncSoon());
            }}
          >
            <Icon name="plus" size={18} /> Add page
          </button>
        </div>
      </div>
      </div>

      {renaming && (
        <PromptDialog
          title="Rename notebook"
          initial={notebook.name}
          confirmLabel="Rename"
          onConfirm={(name) => void renameItem(db, notebook.id, name).then(() => sync.syncSoon())}
          onClose={() => setRenaming(false)}
        />
      )}

      {exportOpen && (
        <Modal title="More" onClose={() => setExportOpen(false)}>
          <label className="field-label">Page appearance</label>
          <div className="segmented" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {([
              [undefined, 'Follow app'],
              ['light', 'Light'],
              ['dark', 'Night'],
            ] as const).map(([value, label]) => (
              <button key={label} className={notebook.pageTheme === value ? 'on' : ''} onClick={() => setPageLook({ pageTheme: value })}>
                {label}
              </button>
            ))}
          </div>
          <div className="menu-list">
            <button onClick={() => setPageLook({ invertPdf: notebook.invertPdf ? undefined : true })}>
              <Icon name={notebook.invertPdf ? 'check' : 'image'} size={18} /> {notebook.invertPdf ? 'PDF pages are inverted in night mode' : 'Invert PDF pages in night mode'}
            </button>
          </div>
          <label className="field-label">Export</label>
          <div className="menu-list">
            <button onClick={() => void exportPdf()}>
              <Icon name="share" size={18} /> Whole notebook as PDF
            </button>
            <button
              onClick={() => {
                setExportOpen(false);
                setExporting({});
              }}
            >
              <Icon name="pages" size={18} /> Choose pages and format
            </button>
            <button onClick={() => void exportVisiblePagePng()}>
              <Icon name="image" size={18} /> Current page as image (PNG)
            </button>
          </div>
          <label className="field-label">PDF</label>
          <div className="menu-list">
            <label className={`menu-file${addingPdf ? ' busy' : ''}`}>
              {addingPdf ? 'Adding PDF…' : 'Add another PDF at the end of this notebook'}
              <input
                type="file"
                accept="application/pdf,.pdf"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setAddingPdf(true);
                  void appendPdf(db, notebook.id, file)
                    .then((count) => {
                      sync.syncSoon();
                      setExportOpen(false);
                      setNotice(`Added ${count} page${count === 1 ? '' : 's'} from ${file.name}`);
                      // Show the first new page.
                      requestAnimationFrame(() => {
                        const el = scrollRef.current;
                        if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
                      });
                    })
                    .catch(() => alert('This PDF could not be opened.'))
                    .finally(() => setAddingPdf(false));
                }}
              />
            </label>
          </div>
          <label className="field-label">Troubleshooting</label>
          <div className="menu-list">
            <button
              onClick={() => {
                diagnostics.enabled = !diagnostics.enabled;
                setShowDiagnostics(diagnostics.enabled);
                setExportOpen(false);
              }}
            >
              {showDiagnostics ? 'Hide' : 'Show'} Pencil diagnostics
            </button>
          </div>
          <label className="field-label">Apple Pencil</label>
          <div className="menu-list">
            <button onClick={() => update({ hoverPalette: !settings.hoverPalette })}>
              Hover palette: {settings.hoverPalette ? 'On' : 'Off'} (hold the Pencil still just above the page)
            </button>
          </div>
        </Modal>
      )}

      {showDiagnostics && <DiagnosticsOverlay />}

      {palette && (
        <QuickPalette
          x={palette.x}
          y={palette.y}
          settings={settings}
          selectSlot={selectSlot}
          selectTool={selectTool}
          undo={undo}
          redo={redo}
          onClose={closePalette}
        />
      )}

      {pagesOpen && (
        <PageManager
          notebookId={notebook.id}
          pageIds={pageIds}
          onOpenPage={openPage}
          onExport={(ids) => {
            setPagesOpen(false);
            setExporting({ picked: ids });
          }}
          onClose={() => setPagesOpen(false)}
        />
      )}

      {exporting && (
        <ExportDialog
          notebook={notebook}
          pageIds={pageIds}
          currentIndex={Math.max(0, pageIds.indexOf(visiblePageId() ?? ''))}
          picked={exporting.picked}
          onPickPages={() => {
            setExporting(null);
            setPagesOpen(true);
          }}
          onClose={() => setExporting(null)}
        />
      )}

      {copyingPage && (
        <CopyPageDialog
          currentNotebookId={notebook.id}
          onClose={() => setCopyingPage(null)}
          onCopy={(target) => {
            void copyPagesTo(db, [copyingPage.id], target).then((ids) => {
              sync.syncSoon();
              setNotice(ids.length ? (target === notebook.id ? 'Page copied to the end of this notebook' : 'Page copied') : 'Could not copy the page');
            });
          }}
        />
      )}

      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}

      {pageMenu && (
        <Modal title="Page options" onClose={() => setPageMenu(null)}>
          <label className="field-label">Paper</label>
          <div className="menu-list">
            {(Object.keys(TEMPLATE_LABELS) as PaperTemplate[]).map((t) => (
              <button
                key={t}
                className={pageMenu.template === t ? 'selected' : ''}
                onClick={() => {
                  void setPageTemplate(db, pageMenu.id, t).then(() => sync.syncSoon());
                  setPageMenu(null);
                }}
              >
                {TEMPLATE_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="menu-list">
            <button
              onClick={() => {
                void addPage(db, notebook.id, pageMenu.id).then(() => sync.syncSoon());
                setPageMenu(null);
              }}
            >
              Insert page after
            </button>
            <button
              onClick={() => {
                const page = pageMenu;
                setPageMenu(null);
                void loadPage(db, page.id).then((full) => {
                  if (full) setClip({ kind: 'pages', pages: [full] });
                  setNotice('Page copied — paste it from Pages in any notebook');
                });
              }}
            >
              Copy page
            </button>
            {getClip()?.kind === 'pages' && (
              <button
                onClick={() => {
                  const clip = getClip();
                  const at = pageIds.indexOf(pageMenu.id) + 1;
                  setPageMenu(null);
                  if (clip?.kind === 'pages') {
                    void pastePages(db, clip.pages, notebook.id, at).then((ids) => {
                      sync.syncSoon();
                      setNotice(`Pasted ${ids.length} page${ids.length === 1 ? '' : 's'}`);
                    });
                  }
                }}
              >
                Paste page{(() => {
                  const clip = getClip();
                  return clip?.kind === 'pages' && clip.pages.length > 1 ? `s (${clip.pages.length})` : '';
                })()} after this page
              </button>
            )}
            <button
              onClick={() => {
                setCopyingPage(pageMenu);
                setPageMenu(null);
              }}
            >
              Copy page to another notebook…
            </button>
            <button
              onClick={() => {
                setPageMenu(null);
                setPagesOpen(true);
              }}
            >
              All pages…
            </button>
            <button
              className="danger-text"
              disabled={pageIds.length <= 1}
              onClick={() => {
                if (confirm('Delete this page?')) void deletePage(db, notebook.id, pageMenu.id).then(() => sync.syncSoon());
                setPageMenu(null);
              }}
            >
              Delete page
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function DiagnosticsOverlay() {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const d = diagnostics;
  const yes = (v: boolean) => (v ? 'yes' : 'NO');
  return (
    <div className="diagnostics" aria-hidden="true">
      {[
        `input        ${d.pointerType}   pressure ${d.pressure}`,
        `samples/s    ${d.samplesPerSecond}   (events/s ${d.eventsPerSecond})`,
        `coalesced    ${yes(d.coalescedSupported)}   predicted ${yes(d.predictedSupported)}`,
        `draw frame   ${d.frameMs} ms   input→draw ${d.inputToDrawMs} ms`,
        `canvas       ${(d.canvasPixels / 1e6).toFixed(1)} MP   dpr ${d.devicePixelRatio}`,
        `cancelled    ${d.cancels}`,
        `hover        ${d.hover}`,
        `tilt         ${d.tilt}`,
        `roll/twist   ${d.twist}`,
      ].join('\n')}
    </div>
  );
}

function notebookPageHeight(scale: number) {
  return 1123 * scale + 40;
}
