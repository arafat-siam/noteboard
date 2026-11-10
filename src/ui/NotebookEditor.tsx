import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { db } from '../db/db';
import { renameItem } from '../db/library';
import { addPage, applyStrokeChange, deletePage, notebookPages, setPageTemplate } from '../db/pages';
import { exportNotebookPdf, exportPagePng, safeFilename, shareOrDownload } from '../export/exporters';
import { InkPage, type ToolKind, type ToolSettings } from '../ink/InkPage';
import { TEMPLATE_LABELS } from '../ink/templates';
import { PAGE_WIDTH, newId, type Page, type PaperTemplate, type Stroke } from '../model/types';
import { onPencilGesture } from '../pencil/bridge';
import { penActiveWithin } from '../ink/penState';
import { diagnostics } from '../ink/diagnostics';
import { sync } from '../sync/instance';
import { Modal, PromptDialog } from './Dialogs';
import { SyncBadge } from './SyncBadge';
import { QuickPalette } from './QuickPalette';
import { ToolPalette } from './ToolPalette';
import { DEFAULT_SLOTS, PEN_COLORS, type PenSlot } from '../ink/palette';
import { newId as makeId } from '../model/types';

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
    ? { ...s, activeSlot: slot.id, tool: 'pen', color: slot.color, penSize: slot.size, penBrush: slot.brush }
    : { ...s, activeSlot: slot.id, tool: 'highlighter', highlighterColor: slot.color, highlighterSize: slot.size };
}

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
  },
  DEFAULT_SLOTS[0]!.id,
);

function loadSettings(): ToolSettings {
  try {
    const saved = JSON.parse(localStorage.getItem('noteboard.tools') ?? '{}') as Partial<ToolSettings>;
    const merged = { ...DEFAULT_SETTINGS, ...saved };
    if (!Array.isArray(saved.slots) || !saved.slots.length) merged.slots = DEFAULT_SLOTS;
    // Keep using the eraser/lasso if that was in hand; otherwise restore the pen in hand.
    return merged.tool === 'eraser' || merged.tool === 'lasso'
      ? { ...withSlot(merged, merged.activeSlot), tool: merged.tool }
      : withSlot(merged, merged.activeSlot);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function NotebookEditor({ notebookId, onClose }: { notebookId: string; onClose: () => void }) {
  const notebook = useLiveQuery(() => db.items.get(notebookId), [notebookId]);
  const pages = useLiveQuery(() => notebookPages(db, notebookId), [notebookId]);
  const pagesRef = useRef<Page[]>([]);
  pagesRef.current = pages ?? [];

  const [settings, setSettings] = useState<ToolSettings>(loadSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const previousTool = useRef<ToolKind>('pen');
  const [undoStack, setUndoStack] = useState<Op[]>([]);
  const [redoStack, setRedoStack] = useState<Op[]>([]);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(800);
  const [renaming, setRenaming] = useState(false);
  const [pageMenu, setPageMenu] = useState<Page | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(diagnostics.enabled);
  const [palette, setPalette] = useState<{ x: number; y: number } | null>(null);
  const openPalette = useCallback((x: number, y: number) => setPalette({ x, y }), []);
  const closePalette = useCallback(() => setPalette(null), []);
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
  const scale = Math.max(0.2, fitScale * zoom);

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
      const page = pagesRef.current.find((p) => p.id === pageId);
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
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (!mod) {
        const map: Record<string, ToolKind> = { p: 'pen', h: 'highlighter', e: 'eraser', l: 'lasso' };
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
  useEffect(() => {
    const el = scrollEl;
    if (!el) return;
    const fingers = new Map<number, { x: number; y: number }>();
    let pan: { x: number; y: number; t: number; vx: number; vy: number } | null = null;
    let pinch: { startDist: number; startZoom: number; current: number; midX: number; midY: number } | null = null;
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
      pan = first ? { x: first.x, y: first.y, t: performance.now(), vx: 0, vy: 0 } : null;
    };
    const startPinch = () => {
      const rect = el.getBoundingClientRect();
      const [a, b] = pair();
      pinch = {
        startDist: Math.max(1, fingerDistance()),
        startZoom: zoomRef.current,
        current: zoomRef.current,
        midX: (a.x + b.x) / 2 - rect.left,
        midY: (a.y + b.y) / 2 - rect.top,
      };
      pan = null;
    };
    const endPinch = () => {
      if (!pinch) return;
      const { current, startZoom, midX, midY } = pinch;
      pinch = null;
      const wrap = pagesWrapRef.current;
      if (wrap) wrap.style.transform = '';
      if (Math.abs(current - startZoom) < 0.01) return;
      const ratio = current / startZoom;
      // Keep the spot between the fingers in place after re-rendering sharply at the new zoom.
      const anchorX = el.scrollLeft + midX;
      const anchorY = el.scrollTop + midY;
      setZoom(current);
      requestAnimationFrame(() => {
        el.scrollLeft = anchorX * ratio - midX;
        el.scrollTop = anchorY * ratio - midY;
      });
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'pen') {
        // The Pencil wins. Any finger gesture still going (or that started moments ago) was
        // the palm resting on the screen: cancel it and put the view back.
        const recent = before && (fingers.size > 0 || performance.now() - before.at < 1500);
        fingers.clear();
        pan = null;
        stopInertia();
        tap = null;
        if (pinch) {
          pinch = null;
          const wrap = pagesWrapRef.current;
          if (wrap) wrap.style.transform = '';
        }
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
        pinch.current = Math.min(4, Math.max(0.5, pinch.startZoom * (fingerDistance() / pinch.startDist)));
        const wrap = pagesWrapRef.current;
        if (wrap) {
          wrap.style.transformOrigin = `${pinch.midX + el.scrollLeft - wrap.offsetLeft}px ${pinch.midY + el.scrollTop - wrap.offsetTop}px`;
          wrap.style.transform = `scale(${pinch.current / pinch.startZoom})`;
        }
      } else if (pan) {
        const now = performance.now();
        const dx = p.x - pan.x;
        const dy = p.y - pan.y;
        el.scrollLeft -= dx;
        el.scrollTop -= dy;
        const dt = Math.max(1, now - pan.t);
        pan.vx = 0.7 * (dx / dt) + 0.3 * pan.vx;
        pan.vy = 0.7 * (dy / dt) + 0.3 * pan.vy;
        pan.x = p.x;
        pan.y = p.y;
        pan.t = now;
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
        if (performance.now() - pan.t > 80) vx = vy = 0; // finger stopped before lifting
        pan = null;
        let last = performance.now();
        const step = (now: number) => {
          const dt = now - last;
          last = now;
          el.scrollLeft -= vx * dt;
          el.scrollTop -= vy * dt;
          const decay = Math.pow(0.996, dt);
          vx *= decay;
          vy *= decay;
          inertia = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : null;
        };
        if (Math.hypot(vx, vy) > 0.05) inertia = requestAnimationFrame(step);
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
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('touchstart', claimTouch);
      el.removeEventListener('touchmove', claimTouch);
    };
  }, [undo, redo, scrollEl]);

  if (notebook === undefined || pages === undefined) return <div className="loading">Loading…</div>;
  if (!notebook || notebook.kind !== 'notebook' || notebook.deleted) {
    return (
      <div className="empty">
        This notebook is no longer available. <button onClick={onClose}>Back to library</button>
      </div>
    );
  }

  const exportPdf = async () => {
    setExportOpen(false);
    await shareOrDownload(await exportNotebookPdf(notebook, await notebookPages(db, notebook.id)), `${safeFilename(notebook.name)}.pdf`);
  };

  const exportVisiblePagePng = async () => {
    setExportOpen(false);
    const el = scrollRef.current;
    const index = el ? Math.min(pages.length - 1, Math.floor(el.scrollTop / (notebookPageHeight(scale) + 24))) : 0;
    const page = pages[Math.max(0, index)];
    if (page) await shareOrDownload(await exportPagePng(page), `${safeFilename(notebook.name)} p${index + 1}.png`);
  };

  return (
    <div className="editor">
      <header className="toolbar editor-top">
        <button className="text-button" onClick={onClose}>
          ‹ Library
        </button>
        <button className="editor-title" onClick={() => setRenaming(true)}>
          {notebook.name}
        </button>
        <span className="muted">{pages.length} page{pages.length === 1 ? '' : 's'}</span>
        <div className="spacer" />
        <div className="zoom-controls">
          <button className="tool" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}>
            −
          </button>
          <button className="tool text" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button className="tool" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z * 1.25))}>
            +
          </button>
        </div>
        <SyncBadge compact />
        <button className="text-button" onClick={() => setExportOpen(true)}>
          Export ⋯
        </button>
      </header>

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
      />

      <div className="pages-scroll" ref={attachScroll}>
        <div className="pages" ref={pagesWrapRef}>
          {pages.map((page, index) => (
            <div key={page.id} className="page-slot">
              <InkPage
                page={page}
                scale={scale}
                settings={settings}
                scroller={scrollEl}
                onChange={onChange}
                onHoverHold={openPalette}
                onRequestSelect={() => selectTool('lasso')}
              />
              <div className="page-footer">
                <span>
                  Page {index + 1} of {pages.length}
                </span>
                <button className="link" onClick={() => setPageMenu(page)}>
                  Page options
                </button>
              </div>
            </div>
          ))}
          <button
            className="add-page"
            onClick={() => {
              void addPage(db, notebook.id).then(() => sync.syncSoon());
            }}
          >
            + Add page
          </button>
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
          <label className="field-label">Export</label>
          <div className="menu-list">
            <button onClick={() => void exportPdf()}>Whole notebook as PDF</button>
            <button onClick={() => void exportVisiblePagePng()}>Current page as image (PNG)</button>
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
              className="danger-text"
              disabled={pages.length <= 1}
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
