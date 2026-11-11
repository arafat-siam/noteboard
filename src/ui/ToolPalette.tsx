import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ToolSettings } from '../ink/InkPage';
import { BRUSHES, BRUSH_ORDER } from '../ink/brushes';
import {
  ERASER_SIZE_RANGE,
  HIGHLIGHTER_COLORS,
  HIGHLIGHTER_SIZE_RANGE,
  MAX_SLOTS,
  PEN_COLORS,
  PEN_SIZE_RANGE,
  type PenSlot,
} from '../ink/palette';
import { PenIcon, type PenIconKind } from './PenIcon';

interface Props {
  settings: ToolSettings;
  update: (patch: Partial<ToolSettings>) => void;
  selectSlot: (id: string) => void;
  updateSlot: (patch: Partial<PenSlot>) => void;
  addSlot: () => void;
  removeSlot: (id: string) => void;
  selectTool: (tool: 'eraser' | 'lasso' | 'laser') => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

type Dock = 'top' | 'bottom';
const DOCK_KEY = 'noteboard.palette.dock';
const MINIMIZED_KEY = 'noteboard.palette.minimized';

export const slotIcon = (slot: PenSlot): PenIconKind => (slot.kind === 'highlighter' ? 'highlighter' : slot.brush);

function stored<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

/**
 * Floating pen tray in the style of Apple Notes. Drag it anywhere; on release it glides to the
 * top or bottom of the screen. Tap the pen in hand to change it; "+" adds another pen.
 */
export function ToolPalette(props: Props) {
  const { settings, update } = props;
  const [dock, setDock] = useState<Dock>(() => stored<Dock>(DOCK_KEY, 'bottom'));
  const [minimized, setMinimized] = useState(() => stored<string>(MINIMIZED_KEY, '0') === '1');
  const [popover, setPopover] = useState<'slot' | 'eraser' | 'lasso' | 'more' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const flipFrom = useRef<DOMRect | null>(null);

  const activeSlot = settings.slots.find((s) => s.id === settings.activeSlot) ?? settings.slots[0];
  const penInHand = settings.tool === 'pen' || settings.tool === 'highlighter';

  useEffect(() => store(DOCK_KEY, dock), [dock]);
  useEffect(() => store(MINIMIZED_KEY, minimized ? '1' : '0'), [minimized]);

  // Close popovers when touching anywhere outside the palette.
  useEffect(() => {
    if (!popover) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setPopover(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [popover]);

  // FLIP: glide from where it was released (or its old size) to its new home.
  useLayoutEffect(() => {
    const el = rootRef.current;
    const from = flipFrom.current;
    flipFrom.current = null;
    if (!el || !from) return;
    const to = el.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
      duration: 320,
      easing: 'cubic-bezier(0.2, 0.9, 0.25, 1.1)',
    });
  }, [dock, minimized]);

  // ---- dragging (from anywhere on the bar that isn't a button) -----------------------
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('button, input, label, .palette-popover')) return;
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const el = rootRef.current;
    if (!d || d.id !== e.pointerId || !el) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    if (!d.moved) setPopover(null);
    d.moved = true;
    el.style.transform = `translate(${dx}px, ${dy}px) scale(1.03)`;
    el.classList.add('dragging');
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const el = rootRef.current;
    dragRef.current = null;
    if (!d || !el || !d.moved) return;
    flipFrom.current = el.getBoundingClientRect();
    el.style.transform = '';
    el.classList.remove('dragging');
    const next: Dock = e.clientY < window.innerHeight * 0.45 ? 'top' : 'bottom';
    if (next === dock) {
      // Same dock: still animate back home.
      const from = flipFrom.current;
      flipFrom.current = null;
      const to = el.getBoundingClientRect();
      el.animate(
        [
          { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` },
          { transform: 'translate(0, 0)' },
        ],
        { duration: 320, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1.1)' },
      );
    } else {
      setDock(next);
    }
  };

  const dragProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  };

  if (minimized) {
    return (
      <div ref={rootRef} className={`tool-palette minimized dock-${dock}`} {...dragProps}>
        <button
          className="palette-mini"
          aria-label="Show tools"
          onClick={() => {
            flipFrom.current = rootRef.current?.getBoundingClientRect() ?? null;
            setMinimized(false);
          }}
        >
          <span className="mini-pen">
            <PenIcon
              kind={penInHand && activeSlot ? slotIcon(activeSlot) : (settings.tool as PenIconKind)}
              color={activeSlot?.color ?? '#000'}
            />
          </span>
        </button>
      </div>
    );
  }

  // ---- popovers ----------------------------------------------------------------------
  let content: ReactNode = null;
  if (popover === 'slot' && activeSlot) {
    const range = activeSlot.kind === 'highlighter' ? HIGHLIGHTER_SIZE_RANGE : PEN_SIZE_RANGE;
    const colors = activeSlot.kind === 'highlighter' ? HIGHLIGHTER_COLORS : PEN_COLORS;
    content = (
      <div className="palette-popover" role="dialog" aria-label="Pen settings">
        <div className="type-chips">
          {[...BRUSH_ORDER.map((b) => ({ key: b, label: BRUSHES[b].label, kind: 'pen' as const, brush: b })), {
            key: 'highlighter',
            label: 'Highlighter',
            kind: 'highlighter' as const,
            brush: activeSlot.brush,
          }].map((opt) => {
            const on = opt.kind === activeSlot.kind && (opt.kind === 'highlighter' || opt.brush === activeSlot.brush);
            return (
              <button
                key={opt.key}
                className={`type-chip ${on ? 'on' : ''}`}
                onClick={() => {
                  if (opt.kind === activeSlot.kind) props.updateSlot({ brush: opt.brush });
                  else
                    props.updateSlot(
                      opt.kind === 'highlighter'
                        ? { kind: 'highlighter', color: HIGHLIGHTER_COLORS[0]!, size: 20 }
                        : { kind: 'pen', brush: opt.brush, color: PEN_COLORS[0]!, size: 2.5 },
                    );
                }}
              >
                <span className="chip-pen">
                  <PenIcon kind={opt.kind === 'highlighter' ? 'highlighter' : opt.brush} color={activeSlot.color} />
                </span>
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className="color-grid">
          {colors.map((c) => (
            <button
              key={c}
              className={`color-dot ${c === activeSlot.color ? 'selected' : ''}`}
              style={{ background: c }}
              aria-label={`Color ${c}`}
              onClick={() => props.updateSlot({ color: c })}
            />
          ))}
          <label className="color-dot custom" aria-label="Custom color">
            <input type="color" value={activeSlot.color} onChange={(e) => props.updateSlot({ color: e.target.value })} />
          </label>
        </div>
        <label className="slider-row">
          <span>Thickness</span>
          <input
            type="range"
            min={range.min}
            max={range.max}
            step={range.step}
            value={activeSlot.size}
            onChange={(e) => props.updateSlot({ size: Number(e.target.value) })}
          />
          <span className="slider-value">{activeSlot.size.toFixed(activeSlot.kind === 'pen' ? 1 : 0)}</span>
        </label>
        <div className="thickness-preview">
          <span
            style={{
              height: Math.max(1, Math.min(28, activeSlot.size * (activeSlot.kind === 'pen' ? 1.4 : 0.7))),
              background: activeSlot.color,
              opacity: activeSlot.kind === 'highlighter' ? 0.5 : 1,
            }}
          />
        </div>
        <button
          className="remove-pen"
          disabled={settings.slots.length <= 1}
          onClick={() => {
            setPopover(null);
            props.removeSlot(activeSlot.id);
          }}
        >
          Remove this pen
        </button>
      </div>
    );
  } else if (popover === 'eraser') {
    content = (
      <div className="palette-popover" role="dialog" aria-label="Eraser settings">
        <div className="segmented">
          <button className={settings.eraserMode === 'stroke' ? 'on' : ''} onClick={() => update({ eraserMode: 'stroke' })}>
            Object eraser
          </button>
          <button className={settings.eraserMode === 'partial' ? 'on' : ''} onClick={() => update({ eraserMode: 'partial' })}>
            Pixel eraser
          </button>
        </div>
        <label className="slider-row">
          <span>Size</span>
          <input
            type="range"
            min={ERASER_SIZE_RANGE.min}
            max={ERASER_SIZE_RANGE.max}
            step={ERASER_SIZE_RANGE.step}
            value={settings.eraserSize}
            onChange={(e) => update({ eraserSize: Number(e.target.value) })}
          />
          <span className="slider-value">{settings.eraserSize}</span>
        </label>
      </div>
    );
  } else if (popover === 'lasso') {
    content = (
      <div className="palette-popover" role="dialog" aria-label="Lasso">
        <p className="popover-hint">
          Circle ink, or tap a stroke, to select it. Drag to move, pull a corner to resize, use ↻ to rotate, or tap a colour
          to recolour. Tip: long-press ink with a finger to select it with any tool.
        </p>
      </div>
    );
  } else if (popover === 'more') {
    const toggle = (label: string, hint: string, on: boolean, patch: Partial<ToolSettings>) => (
      <button className="toggle-row" onClick={() => update(patch)}>
        <span>
          {label}
          <small>{hint}</small>
        </span>
        <span className={`switch ${on ? 'on' : ''}`} />
      </button>
    );
    content = (
      <div className="palette-popover" role="dialog" aria-label="More tools">
        {toggle('Shape recognition', 'Hold the Pencil still at the end of a stroke', settings.shapeSnap, {
          shapeSnap: !settings.shapeSnap,
        })}
        {toggle('Draw with finger', 'Otherwise fingers scroll and zoom', settings.fingerDraws, {
          fingerDraws: !settings.fingerDraws,
        })}
        {toggle('Hover palette', 'Hold the Pencil just above the page', settings.hoverPalette, {
          hoverPalette: !settings.hoverPalette,
        })}
        {toggle('Hover cursor', 'Shows where the ink will land while the Pencil hovers', settings.hoverPreview !== false, {
          hoverPreview: settings.hoverPreview === false,
        })}
        <div className="segmented">
          <button className={dock === 'top' ? 'on' : ''} onClick={() => setDock('top')}>
            Toolbar on top
          </button>
          <button className={dock === 'bottom' ? 'on' : ''} onClick={() => setDock('bottom')}>
            Toolbar at bottom
          </button>
        </div>
      </div>
    );
  }

  const toggle = (name: 'slot' | 'eraser' | 'lasso' | 'more') => setPopover((p) => (p === name ? null : name));

  return (
    <div ref={rootRef} className={`tool-palette dock-${dock}`} {...dragProps}>
      {content}
      <div className="palette-row">
        <button className="palette-button" aria-label="Undo" disabled={!props.canUndo} onClick={props.undo}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 7 4 12l5 5M4.5 12H15a5 5 0 0 1 0 10h-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="palette-button" aria-label="Redo" disabled={!props.canRedo} onClick={props.redo}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 7 5 5-5 5M19.5 12H9a5 5 0 0 0 0 10h2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="pen-tray">
          {settings.slots.map((slot) => {
            const active = penInHand && slot.id === settings.activeSlot;
            return (
              <button
                key={slot.id}
                className={`pen ${active ? 'active' : ''}`}
                aria-label={`${slot.kind === 'highlighter' ? 'Highlighter' : BRUSHES[slot.brush].label}, ${slot.color}`}
                aria-pressed={active}
                onClick={() => {
                  if (active) toggle('slot');
                  else {
                    setPopover(null);
                    props.selectSlot(slot.id);
                  }
                }}
              >
                <PenIcon kind={slotIcon(slot)} color={slot.color} />
              </button>
            );
          })}
          <span className="tray-divider" />
          {(['eraser', 'lasso', 'laser'] as const).map((tool) => (
            <button
              key={tool}
              className={`pen ${settings.tool === tool ? 'active' : ''}`}
              aria-label={tool === 'eraser' ? 'Eraser' : tool === 'lasso' ? 'Lasso' : 'Laser pointer'}
              aria-pressed={settings.tool === tool}
              onClick={() => {
                if (settings.tool === tool) {
                  if (tool !== 'laser') toggle(tool);
                }
                else {
                  setPopover(null);
                  props.selectTool(tool);
                }
              }}
            >
              <PenIcon kind={tool} color="#888" />
            </button>
          ))}
          <button
            className="add-pen"
            aria-label="Add a pen"
            disabled={settings.slots.length >= MAX_SLOTS}
            onClick={() => {
              props.addSlot();
              setPopover('slot');
            }}
          >
            +
          </button>
        </div>

        <button
          className="palette-color"
          aria-label="Pen colour and thickness"
          style={{ background: activeSlot?.color }}
          onClick={() => {
            if (!penInHand && activeSlot) props.selectSlot(activeSlot.id);
            toggle('slot');
          }}
        />
        <button className="palette-button" aria-label="More options" onClick={() => toggle('more')}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" fill="currentColor" />
            <circle cx="12" cy="12" r="1.8" fill="currentColor" />
            <circle cx="19" cy="12" r="1.8" fill="currentColor" />
          </svg>
        </button>
        <button
          className="palette-button"
          aria-label="Minimize tools"
          onClick={() => {
            flipFrom.current = rootRef.current?.getBoundingClientRect() ?? null;
            setPopover(null);
            setMinimized(true);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={dock === 'top' ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
