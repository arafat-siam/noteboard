import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ToolSettings, ToolKind } from '../ink/InkPage';
import { BRUSHES, BRUSH_ORDER, type BrushKind } from '../ink/brushes';
import {
  ERASER_SIZE_RANGE,
  HIGHLIGHTER_COLORS,
  HIGHLIGHTER_SIZE_RANGE,
  PEN_COLORS,
  PEN_SIZE_RANGE,
} from '../ink/palette';

interface Props {
  settings: ToolSettings;
  update: (patch: Partial<ToolSettings>) => void;
  selectTool: (tool: ToolKind) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

type Item = { key: string; label: string; tool: ToolKind; brush?: BrushKind };

const ITEMS: Item[] = [
  ...BRUSH_ORDER.map((brush) => ({ key: brush, label: BRUSHES[brush].label, tool: 'pen' as const, brush })),
  { key: 'highlighter', label: 'Highlighter', tool: 'highlighter' },
  { key: 'eraser', label: 'Eraser', tool: 'eraser' },
  { key: 'lasso', label: 'Lasso', tool: 'lasso' },
];

const POSITION_KEY = 'noteboard.palette.position';
const MINIMIZED_KEY = 'noteboard.palette.minimized';

function loadPosition(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    return raw ? (JSON.parse(raw) as { x: number; y: number }) : null;
  } catch {
    return null;
  }
}

/** Pen illustration in the style of a pen standing in a tray; the tip shows the ink colour. */
function PenIcon({ item, color }: { item: Item; color: string }) {
  const body = '#f4f4f6';
  const edge = 'rgba(0,0,0,0.18)';
  switch (item.key) {
    case 'fountain':
      return (
        <svg viewBox="0 0 30 70" aria-hidden="true">
          <rect x="6" y="26" width="18" height="44" rx="3" fill="#2b2b30" />
          <path d="M8 27 L15 4 L22 27 Z" fill="#d9b45a" stroke={edge} />
          <path d="M15 4 L13 16 L17 16 Z" fill={color} />
          <rect x="6" y="40" width="18" height="5" fill={color} />
        </svg>
      );
    case 'ballpoint':
      return (
        <svg viewBox="0 0 30 70" aria-hidden="true">
          <rect x="7" y="24" width="16" height="46" rx="3" fill={body} stroke={edge} />
          <path d="M9 25 L15 6 L21 25 Z" fill={body} stroke={edge} />
          <circle cx="15" cy="7" r="2.2" fill={color} />
          <rect x="7" y="44" width="16" height="6" fill={color} />
        </svg>
      );
    case 'pencil':
      return (
        <svg viewBox="0 0 30 70" aria-hidden="true">
          <rect x="7" y="24" width="16" height="46" fill="#f2c14e" stroke={edge} />
          <rect x="12" y="24" width="6" height="46" fill="#e5ad2f" />
          <path d="M7 25 L15 4 L23 25 Z" fill="#f3d9a8" stroke={edge} />
          <path d="M12 12 L15 4 L18 12 Z" fill={color} />
        </svg>
      );
    case 'brush':
      return (
        <svg viewBox="0 0 30 70" aria-hidden="true">
          <rect x="9" y="30" width="12" height="40" rx="2" fill="#8d6e63" />
          <rect x="8" y="24" width="14" height="8" fill="#c0c0c6" />
          <path d="M8 25 C8 14 15 2 15 2 C15 2 22 14 22 25 Z" fill={color} />
        </svg>
      );
    case 'highlighter':
      return (
        <svg viewBox="0 0 30 70" aria-hidden="true">
          <rect x="5" y="26" width="20" height="44" rx="3" fill={body} stroke={edge} />
          <path d="M7 27 L9 10 L21 6 L23 27 Z" fill={color} opacity="0.9" />
          <rect x="5" y="46" width="20" height="6" fill={color} />
        </svg>
      );
    case 'eraser':
      return (
        <svg viewBox="0 0 30 70" aria-hidden="true">
          <rect x="5" y="28" width="20" height="42" rx="3" fill={body} stroke={edge} />
          <rect x="5" y="8" width="20" height="22" rx="4" fill="#f4a3b4" stroke={edge} />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 30 70" aria-hidden="true">
          <rect x="7" y="26" width="16" height="44" rx="3" fill={body} stroke={edge} />
          <ellipse cx="15" cy="14" rx="10" ry="8" fill="none" stroke="#2f6fde" strokeWidth="2" strokeDasharray="3 2" />
        </svg>
      );
  }
}

export function ToolPalette({ settings, update, selectTool, undo, redo, canUndo, canRedo }: Props) {
  const [position, setPosition] = useState(loadPosition);
  const [minimized, setMinimized] = useState(() => {
    try {
      return localStorage.getItem(MINIMIZED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [popover, setPopover] = useState<'settings' | 'colors' | 'more' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(MINIMIZED_KEY, minimized ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [minimized]);

  // Close popovers when touching outside the palette.
  useEffect(() => {
    if (!popover) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setPopover(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [popover]);

  const activeKey =
    settings.tool === 'pen' ? settings.penBrush : settings.tool === 'highlighter' ? 'highlighter' : settings.tool;
  const activeItem = ITEMS.find((i) => i.key === activeKey) ?? ITEMS[0]!;
  const inkColor = settings.tool === 'highlighter' ? settings.highlighterColor : settings.color;

  const choose = (item: Item) => {
    if (item.key === activeKey) {
      setPopover((p) => (p === 'settings' ? null : 'settings'));
      return;
    }
    setPopover(null);
    selectTool(item.tool);
    if (item.brush) update({ penBrush: item.brush });
  };

  // ---- dragging -------------------------------------------------------------------------
  const onGripDown = (e: React.PointerEvent) => {
    const rect = rootRef.current!.getBoundingClientRect();
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onGripMove = (e: React.PointerEvent) => {
    if (!drag.current || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const x = Math.min(Math.max(8, e.clientX - drag.current.dx), window.innerWidth - rect.width - 8);
    const y = Math.min(Math.max(8, e.clientY - drag.current.dy), window.innerHeight - rect.height - 8);
    setPosition({ x, y });
  };
  const onGripUp = () => {
    drag.current = null;
    try {
      if (position) localStorage.setItem(POSITION_KEY, JSON.stringify(position));
    } catch {
      /* ignore */
    }
  };

  const style = position ? { left: position.x, top: position.y } : undefined;

  if (minimized) {
    return (
      <div ref={rootRef} className={`tool-palette minimized ${position ? 'placed' : ''}`} style={style}>
        <button className="palette-mini" aria-label="Show tools" onClick={() => setMinimized(false)}>
          <span className="mini-pen">
            <PenIcon item={activeItem} color={inkColor} />
          </span>
        </button>
      </div>
    );
  }

  const sizeRange =
    settings.tool === 'highlighter' ? HIGHLIGHTER_SIZE_RANGE : settings.tool === 'eraser' ? ERASER_SIZE_RANGE : PEN_SIZE_RANGE;
  const sizeValue =
    settings.tool === 'highlighter' ? settings.highlighterSize : settings.tool === 'eraser' ? settings.eraserSize : settings.penSize;
  const setSize = (v: number) =>
    update(settings.tool === 'highlighter' ? { highlighterSize: v } : settings.tool === 'eraser' ? { eraserSize: v } : { penSize: v });

  let popoverContent: ReactNode = null;
  if (popover === 'settings') {
    popoverContent = (
      <div className="palette-popover" role="dialog" aria-label={`${activeItem.label} settings`}>
        <div className="popover-title">{activeItem.label}</div>
        {settings.tool === 'eraser' && (
          <div className="segmented">
            <button className={settings.eraserMode === 'stroke' ? 'on' : ''} onClick={() => update({ eraserMode: 'stroke' })}>
              Object eraser
            </button>
            <button className={settings.eraserMode === 'partial' ? 'on' : ''} onClick={() => update({ eraserMode: 'partial' })}>
              Pixel eraser
            </button>
          </div>
        )}
        {settings.tool === 'lasso' ? (
          <p className="popover-hint">Circle ink to select it. Drag to move, pull a corner to resize, or tap a colour to recolour.</p>
        ) : (
          <>
            <label className="slider-row">
              <span>Thickness</span>
              <input
                type="range"
                min={sizeRange.min}
                max={sizeRange.max}
                step={sizeRange.step}
                value={sizeValue}
                onChange={(e) => setSize(Number(e.target.value))}
              />
              <span className="slider-value">{sizeValue.toFixed(settings.tool === 'pen' ? 1 : 0)}</span>
            </label>
            {settings.tool !== 'eraser' && (
              <div className="thickness-preview">
                <span
                  style={{
                    height: Math.max(1, Math.min(28, sizeValue * (settings.tool === 'pen' ? 1.4 : 0.7))),
                    background: inkColor,
                    opacity: settings.tool === 'highlighter' ? 0.5 : 1,
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
    );
  } else if (popover === 'colors') {
    const colors = settings.tool === 'highlighter' ? HIGHLIGHTER_COLORS : PEN_COLORS;
    const set = (c: string) => update(settings.tool === 'highlighter' ? { highlighterColor: c } : { color: c });
    popoverContent = (
      <div className="palette-popover" role="dialog" aria-label="Colors">
        <div className="popover-title">Color</div>
        <div className="color-grid">
          {colors.map((c) => (
            <button
              key={c}
              className={`color-dot ${c === inkColor ? 'selected' : ''}`}
              style={{ background: c }}
              aria-label={`Color ${c}`}
              onClick={() => {
                set(c);
                setPopover(null);
              }}
            />
          ))}
          <label className="color-dot custom" aria-label="Custom color">
            <input type="color" value={inkColor} onChange={(e) => set(e.target.value)} />
          </label>
        </div>
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
    popoverContent = (
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
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`tool-palette ${position ? 'placed' : ''}`} style={style}>
      {popoverContent}
      <div
        className="palette-grip"
        aria-label="Move tool palette"
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={onGripUp}
      />
      <div className="palette-row">
        <button className="palette-button" aria-label="Undo" disabled={!canUndo} onClick={undo}>
          ↶
        </button>
        <button className="palette-button" aria-label="Redo" disabled={!canRedo} onClick={redo}>
          ↷
        </button>
        <div className="pen-tray">
          {ITEMS.map((item) => (
            <button
              key={item.key}
              className={`pen ${item.key === activeKey ? 'active' : ''}`}
              aria-label={item.label}
              aria-pressed={item.key === activeKey}
              onClick={() => choose(item)}
            >
              <PenIcon
                item={item}
                color={item.tool === 'highlighter' ? settings.highlighterColor : item.tool === 'pen' ? settings.color : '#888'}
              />
            </button>
          ))}
        </div>
        <button
          className="palette-color"
          aria-label="Color"
          style={{ background: inkColor }}
          onClick={() => setPopover((p) => (p === 'colors' ? null : 'colors'))}
        />
        <button className="palette-button" aria-label="More options" onClick={() => setPopover((p) => (p === 'more' ? null : 'more'))}>
          ⋯
        </button>
        <button className="palette-button" aria-label="Minimize tools" onClick={() => setMinimized(true)}>
          ⌄
        </button>
      </div>
    </div>
  );
}
