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
import { sync } from '../sync/instance';
import { Modal, PromptDialog } from './Dialogs';
import { SyncBadge } from './SyncBadge';

interface Op {
  pageId: string;
  added: Stroke[];
  removed: Stroke[];
}

const PEN_COLORS = ['#1c1c1e', '#2f6fde', '#d93025', '#1e8e3e', '#f29900', '#9334e6'];
const HIGHLIGHTER_COLORS = ['#ffe14d', '#7cf29c', '#7cd4ff', '#ff9ad5', '#ffb86b'];
const PEN_SIZES = [1.5, 2.5, 4, 7];
const HIGHLIGHTER_SIZES = [12, 20, 30];
const ERASER_SIZES = [8, 18, 36];

const DEFAULT_SETTINGS: ToolSettings = {
  tool: 'pen',
  color: PEN_COLORS[0]!,
  highlighterColor: HIGHLIGHTER_COLORS[0]!,
  penSize: PEN_SIZES[1]!,
  highlighterSize: HIGHLIGHTER_SIZES[1]!,
  eraserSize: ERASER_SIZES[1]!,
  shapeSnap: true,
  fingerDraws: false,
};

function loadSettings(): ToolSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem('noteboard.tools') ?? '{}') as Partial<ToolSettings>) };
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
  const previousTool = useRef<ToolKind>('pen');
  const [undoStack, setUndoStack] = useState<Op[]>([]);
  const [redoStack, setRedoStack] = useState<Op[]>([]);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(800);
  const [renaming, setRenaming] = useState(false);
  const [pageMenu, setPageMenu] = useState<Page | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
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
    setSettings((s) => {
      if (s.tool !== tool) previousTool.current = s.tool;
      return { ...s, tool };
    });
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry?.contentRect.width ?? 800));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
    const offPencil = onPencilGesture((gesture) => {
      if (gesture === 'doubleTap') {
        // Like Apple Notes: double-tap flips between the current tool and the eraser.
        setSettings((s) => {
          if (s.tool === 'eraser') {
            return { ...s, tool: previousTool.current === 'eraser' ? 'pen' : previousTool.current };
          }
          previousTool.current = s.tool;
          return { ...s, tool: 'eraser' };
        });
      } else {
        setSettings((s) => ({ ...s, tool: s.tool === 'highlighter' ? 'pen' : 'highlighter' }));
      }
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      offPencil();
    };
  }, [undo, redo, selectTool]);

  // ---- Touch: Pencil never scrolls, two/three-finger tap = undo/redo, pinch = zoom ---------
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let pinch: { startDist: number; startZoom: number; current: number; active: boolean } | null = null;
    let tap: { fingers: number; start: number; moved: boolean; x: number; y: number } | null = null;

    const fingers = (list: TouchList) => [...list].filter((t) => (t as Touch & { touchType?: string }).touchType !== 'stylus');
    const hasStylus = (list: TouchList) =>
      [...list].some((t) => (t as Touch & { touchType?: string }).touchType === 'stylus');
    const dist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    const onStart = (e: TouchEvent) => {
      if (hasStylus(e.changedTouches)) {
        e.preventDefault(); // the Pencil writes; it must never scroll the page
        return;
      }
      const f = fingers(e.touches);
      if (f.length >= 2) {
        tap = tap && !tap.moved ? { ...tap, fingers: Math.max(tap.fingers, f.length) } : { fingers: f.length, start: Date.now(), moved: false, x: f[0]!.clientX, y: f[0]!.clientY };
      } else if (f.length === 1) {
        tap = { fingers: 1, start: Date.now(), moved: false, x: f[0]!.clientX, y: f[0]!.clientY };
      }
      if (f.length === 2) pinch = { startDist: dist(f[0]!, f[1]!), startZoom: zoomRef.current, current: zoomRef.current, active: false };
    };

    const onMove = (e: TouchEvent) => {
      if (hasStylus(e.touches)) {
        e.preventDefault();
        return;
      }
      const f = fingers(e.touches);
      if (tap && f[0] && Math.hypot(f[0].clientX - tap.x, f[0].clientY - tap.y) > 12) tap.moved = true;
      if (pinch && f.length === 2) {
        const ratio = dist(f[0]!, f[1]!) / pinch.startDist;
        if (pinch.active || Math.abs(ratio - 1) > 0.06) {
          pinch.active = true;
          tap = null;
          e.preventDefault();
          pinch.current = Math.min(4, Math.max(0.5, pinch.startZoom * ratio));
          const wrap = pagesWrapRef.current;
          if (wrap) {
            const midX = (f[0]!.clientX + f[1]!.clientX) / 2 - wrap.getBoundingClientRect().left;
            const midY = (f[0]!.clientY + f[1]!.clientY) / 2 - wrap.getBoundingClientRect().top;
            wrap.style.transformOrigin = `${midX}px ${midY}px`;
            wrap.style.transform = `scale(${pinch.current / pinch.startZoom})`;
          }
        }
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (pinch?.active && fingers(e.touches).length < 2) {
        const { current, startZoom } = pinch;
        const wrap = pagesWrapRef.current;
        if (wrap) wrap.style.transform = '';
        const ratio = current / startZoom;
        setZoom(current);
        requestAnimationFrame(() => {
          el.scrollTop *= ratio;
          el.scrollLeft *= ratio;
        });
        pinch = null;
      }
      if (e.touches.length === 0) {
        if (tap && !tap.moved && Date.now() - tap.start < 300) {
          if (tap.fingers === 2) undo();
          else if (tap.fingers === 3) redo();
        }
        tap = null;
        pinch = null;
      }
    };

    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [undo, redo]);

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

  const sizes = settings.tool === 'highlighter' ? HIGHLIGHTER_SIZES : settings.tool === 'eraser' ? ERASER_SIZES : PEN_SIZES;
  const currentSize =
    settings.tool === 'highlighter' ? settings.highlighterSize : settings.tool === 'eraser' ? settings.eraserSize : settings.penSize;
  const colors = settings.tool === 'highlighter' ? HIGHLIGHTER_COLORS : PEN_COLORS;
  const currentColor = settings.tool === 'highlighter' ? settings.highlighterColor : settings.color;

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
        <SyncBadge compact />
        <button className="text-button" onClick={() => setExportOpen(true)}>
          Export
        </button>
      </header>

      <div className="toolbar tools">
        <div className="tool-group">
          {(
            [
              ['pen', '✒️', 'Pen (P)'],
              ['highlighter', '🖍️', 'Highlighter (H)'],
              ['eraser', '🩹', 'Eraser (E)'],
              ['lasso', '➰', 'Lasso (L)'],
            ] as const
          ).map(([tool, icon, label]) => (
            <button
              key={tool}
              className={`tool ${settings.tool === tool ? 'active' : ''}`}
              aria-label={label}
              title={label}
              onClick={() => selectTool(tool)}
            >
              {icon}
            </button>
          ))}
        </div>

        {(settings.tool === 'pen' || settings.tool === 'highlighter') && (
          <div className="tool-group">
            {colors.map((c) => (
              <button
                key={c}
                className={`color-dot small ${c === currentColor ? 'selected' : ''}`}
                style={{ background: c }}
                aria-label={`Color ${c}`}
                onClick={() => update(settings.tool === 'highlighter' ? { highlighterColor: c } : { color: c })}
              />
            ))}
            <label className="color-dot small custom" aria-label="Custom color">
              <input
                type="color"
                value={currentColor}
                onChange={(e) => update(settings.tool === 'highlighter' ? { highlighterColor: e.target.value } : { color: e.target.value })}
              />
            </label>
          </div>
        )}

        {settings.tool !== 'lasso' && (
          <div className="tool-group">
            {sizes.map((size) => (
              <button
                key={size}
                className={`size ${size === currentSize ? 'active' : ''}`}
                aria-label={`Size ${size}`}
                onClick={() =>
                  update(settings.tool === 'highlighter' ? { highlighterSize: size } : settings.tool === 'eraser' ? { eraserSize: size } : { penSize: size })
                }
              >
                <span style={{ width: Math.min(22, 3 + size * (settings.tool === 'pen' ? 2.2 : 0.6)), height: Math.min(22, 3 + size * (settings.tool === 'pen' ? 2.2 : 0.6)) }} />
              </button>
            ))}
          </div>
        )}

        <div className="tool-group">
          <button
            className={`tool text ${settings.shapeSnap ? 'active' : ''}`}
            title="Hold the Pencil still at the end of a stroke to turn it into a perfect shape"
            onClick={() => update({ shapeSnap: !settings.shapeSnap })}
          >
            △ Shapes
          </button>
          <button
            className={`tool text ${settings.fingerDraws ? 'active' : ''}`}
            title="Draw with your finger (otherwise fingers scroll and only the Pencil draws)"
            onClick={() => update({ fingerDraws: !settings.fingerDraws })}
          >
            ☝️ Finger
          </button>
        </div>

        <div className="tool-group">
          <button className="tool" aria-label="Undo" title="Undo (two-finger tap)" disabled={!undoStack.length} onClick={undo}>
            ↶
          </button>
          <button className="tool" aria-label="Redo" title="Redo (three-finger tap)" disabled={!redoStack.length} onClick={redo}>
            ↷
          </button>
        </div>

        <div className="tool-group">
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
      </div>

      <div className="pages-scroll" ref={scrollRef}>
        <div className="pages" ref={pagesWrapRef}>
          {pages.map((page, index) => (
            <div key={page.id} className="page-slot">
              <InkPage page={page} scale={scale} settings={settings} onChange={onChange} />
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
        <Modal title="Export" onClose={() => setExportOpen(false)}>
          <div className="menu-list">
            <button onClick={() => void exportPdf()}>Whole notebook as PDF</button>
            <button onClick={() => void exportVisiblePagePng()}>Current page as image (PNG)</button>
          </div>
        </Modal>
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

function notebookPageHeight(scale: number) {
  return 1123 * scale + 40;
}
