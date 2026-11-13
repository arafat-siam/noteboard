import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ToolKind, ToolSettings } from '../ink/InkPage';
import { BRUSHES, BRUSH_ORDER, resolveBrush, type BrushKind } from '../ink/brushes';
import {
  ERASER_SIZE_RANGE,
  HIGHLIGHTER_COLORS,
  HIGHLIGHTER_SIZE_RANGE,
  LASER_COLORS,
  MAX_SLOTS,
  PEN_COLORS,
  PEN_SIZE_RANGE,
  SHAPE_SIZE_RANGE,
  TAPE_COLORS,
  TAPE_SIZE_RANGE,
  type PenSlot,
} from '../ink/palette';
import { Slider } from '../ink/Slider';
import { drawStroke } from '../ink/render';
import { SHAPE_TOOLS } from '../ink/shapeTool';
import { TEXT_FONT_ORDER, TEXT_FONTS } from '../ink/text';
import { ITEM_KINDS } from '../ink/selection';
import type { PenStyle, Stroke } from '../model/types';
import { DashSample, Icon, ShapeGlyph } from './Icon';
import { PenIcon, type PenIconKind } from './PenIcon';

export type PaletteSide = 'top' | 'bottom' | 'left' | 'right';
export type PaletteStyle = 'floating' | 'docked';
export interface PaletteLayout {
  style: PaletteStyle;
  side: PaletteSide;
}

const LAYOUT_KEY = 'noteboard.palette.layout';
const OLD_DOCK_KEY = 'noteboard.palette.dock';
const MINIMIZED_KEY = 'noteboard.palette.minimized';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

/** Toolbar style and position, remembered on this device. */
export function usePaletteLayout(): [PaletteLayout, (l: PaletteLayout) => void] {
  const [layout, setLayout] = useState<PaletteLayout>(() => {
    try {
      const saved = JSON.parse(readStorage(LAYOUT_KEY) ?? 'null') as PaletteLayout | null;
      if (saved && ['top', 'bottom', 'left', 'right'].includes(saved.side)) return saved;
    } catch {
      /* fall through */
    }
    const old = readStorage(OLD_DOCK_KEY);
    return { style: 'floating', side: old === 'top' ? 'top' : 'bottom' };
  });
  return [
    layout,
    (l) => {
      setLayout(l);
      writeStorage(LAYOUT_KEY, JSON.stringify(l));
    },
  ];
}

interface Props {
  settings: ToolSettings;
  update: (patch: Partial<ToolSettings>) => void;
  selectSlot: (id: string) => void;
  updateSlot: (patch: Partial<PenSlot>) => void;
  addSlot: () => void;
  removeSlot: (id: string) => void;
  selectTool: (tool: ToolKind) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  layout: PaletteLayout;
  setLayout: (layout: PaletteLayout) => void;
  /** Select everything on the page on screen. */
  onSelectAll?: () => void;
}

type Popover = 'slot' | 'eraser' | 'lasso' | 'text' | 'shape' | 'tape' | 'laser' | 'more';
const TOOLS: { tool: Exclude<ToolKind, 'pen' | 'highlighter'>; label: string }[] = [
  { tool: 'eraser', label: 'Eraser' },
  { tool: 'lasso', label: 'Lasso' },
  { tool: 'text', label: 'Text' },
  { tool: 'shape', label: 'Shapes' },
  { tool: 'tape', label: 'Tape' },
  { tool: 'laser', label: 'Laser pointer' },
];

export const slotIcon = (slot: PenSlot): PenIconKind => (slot.kind === 'highlighter' ? 'highlighter' : slot.brush);

/** Colour swatches plus a picker for any colour (and its hex code). */
function ColorPicker({ colors, value, onChange, label = 'Colour' }: { colors: string[]; value: string; onChange: (c: string) => void; label?: string }) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  return (
    <div className="color-picker">
      <div className="color-grid" role="group" aria-label={label}>
        {colors.map((c) => (
          <button
            key={c}
            className={`color-dot ${c.toLowerCase() === value.toLowerCase() ? 'selected' : ''}`}
            style={{ background: c }}
            aria-label={`${label} ${c}`}
            onClick={() => onChange(c)}
          />
        ))}
        <label className="color-dot custom" aria-label={`Custom ${label.toLowerCase()}`}>
          <input type="color" value={value.length === 7 ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
        </label>
      </div>
      <label className="hex-field">
        <span>Hex</span>
        <input
          value={hex}
          maxLength={7}
          spellCheck={false}
          autoCapitalize="off"
          onChange={(e) => {
            const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
            setHex(v);
            if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toLowerCase());
          }}
        />
      </label>
    </div>
  );
}

/** A labelled slider row that works with Pencil and fingers. */
function SliderRow(props: { label: string; value: number; min: number; max: number; step: number; format?: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <div className="slider-row">
      <span>{props.label}</span>
      <Slider value={props.value} min={props.min} max={props.max} step={props.step} label={props.label} onInput={props.onChange} onCommit={props.onChange} />
      <span className="slider-value">{props.format ? props.format(props.value) : props.value}</span>
    </div>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className="toggle-row" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <span className={`switch ${on ? 'on' : ''}`} />
    </button>
  );
}

function Segmented<T extends string | number | null>(props: { value: T; options: { value: T; label: ReactNode; aria?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" style={{ gridTemplateColumns: `repeat(${props.options.length}, 1fr)` }}>
      {props.options.map((o) => (
        <button key={String(o.value)} className={o.value === props.value ? 'on' : ''} aria-label={o.aria} aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Live sample of the pen, drawn by the real ink renderer. */
function PenPreview({ stroke }: { stroke: Omit<Stroke, 'points' | 'id' | 'createdAt'> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 280;
    const h = canvas.clientHeight || 46;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const points: number[] = [];
    const n = 80;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      points.push(16 + t * (w - 32), h / 2 + Math.sin(t * Math.PI * 2.2) * (h * 0.26), 0.25 + 0.75 * Math.sin(t * Math.PI));
    }
    drawStroke(ctx, { ...stroke, id: `preview-${Math.random()}`, points, createdAt: 0 } as Stroke, true);
  });
  return <canvas ref={ref} className="pen-preview" aria-hidden="true" />;
}

/**
 * The tool bar. Two styles: floating (a pill you can drag to any edge) or docked (a full-width
 * bar joined to the edge of the screen), and either one on the top, bottom, left or right.
 */
export function ToolPalette(props: Props) {
  const { settings, update, layout, setLayout } = props;
  const { style, side } = layout;
  const vertical = side === 'left' || side === 'right';
  const [minimized, setMinimized] = useState(() => readStorage(MINIMIZED_KEY) === '1');
  const [popover, setPopover] = useState<Popover | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const flipFrom = useRef<DOMRect | null>(null);

  const activeSlot = settings.slots.find((s) => s.id === settings.activeSlot) ?? settings.slots[0];
  const penInHand = settings.tool === 'pen' || settings.tool === 'highlighter';
  const isMinimized = minimized && style === 'floating';

  useEffect(() => writeStorage(MINIMIZED_KEY, minimized ? '1' : '0'), [minimized]);

  // Close popovers when touching anywhere outside the palette.
  useEffect(() => {
    if (!popover) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setPopover(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPopover(null);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
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
  }, [side, minimized, style]);

  // ---- dragging a floating bar to any edge (from anywhere that isn't a button) ----------
  const onPointerDown = (e: React.PointerEvent) => {
    if (style !== 'floating') return;
    if ((e.target as Element).closest('button, input, label, select, .palette-popover, [role="slider"]')) return;
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
    // The nearest edge of the screen wins.
    const w = window.innerWidth;
    const h = window.innerHeight;
    const distances: [PaletteSide, number][] = [
      ['top', e.clientY / h],
      ['bottom', (h - e.clientY) / h],
      ['left', (e.clientX / w) * 1.6],
      ['right', ((w - e.clientX) / w) * 1.6],
    ];
    const next = distances.sort((a, b) => a[1] - b[1])[0]![0];
    if (next === side) {
      const from = flipFrom.current;
      flipFrom.current = null;
      const to = el.getBoundingClientRect();
      el.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'translate(0, 0)' }], {
        duration: 320,
        easing: 'cubic-bezier(0.2, 0.9, 0.25, 1.1)',
      });
    } else {
      setLayout({ ...layout, side: next });
    }
  };
  const dragProps = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };

  const classes = `tool-palette ${style} side-${side}${vertical ? ' vertical' : ''}`;

  if (isMinimized) {
    return (
      <div ref={rootRef} className={`${classes} minimized`} {...dragProps}>
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

  const toggle = (name: Popover) => setPopover((p) => (p === name ? null : name));

  // ---- popovers ----------------------------------------------------------------------
  let content: ReactNode = null;
  if (popover === 'slot' && activeSlot) {
    const isHighlighter = activeSlot.kind === 'highlighter';
    const range = isHighlighter ? HIGHLIGHTER_SIZE_RANGE : PEN_SIZE_RANGE;
    const brush = resolveBrush({ brush: activeSlot.brush, penStyle: activeSlot.penStyle });
    const setStyle = (patch: PenStyle) => props.updateSlot({ penStyle: { ...activeSlot.penStyle, ...patch } });
    content = (
      <div className="palette-popover wide" role="dialog" aria-label="Pen settings">
        <div className="popover-title">{isHighlighter ? 'Highlighter' : BRUSHES[activeSlot.brush]?.label ?? 'Pen'}</div>
        <div className="type-chips">
          {[...BRUSH_ORDER.map((b) => ({ key: b as string, label: BRUSHES[b].label, kind: 'pen' as const, brush: b })), {
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
                aria-pressed={on}
                onClick={() => {
                  if (opt.kind === activeSlot.kind) props.updateSlot({ brush: opt.brush as BrushKind, penStyle: undefined });
                  else
                    props.updateSlot(
                      opt.kind === 'highlighter'
                        ? { kind: 'highlighter', color: HIGHLIGHTER_COLORS[0]!, size: 20, penStyle: undefined }
                        : { kind: 'pen', brush: opt.brush as BrushKind, color: PEN_COLORS[0]!, size: 2.5, penStyle: undefined },
                    );
                }}
              >
                <span className="chip-pen">
                  <PenIcon kind={opt.kind === 'highlighter' ? 'highlighter' : (opt.brush as BrushKind)} color={activeSlot.color} />
                </span>
                {opt.label}
              </button>
            );
          })}
        </div>
        <PenPreview
          stroke={{
            tool: isHighlighter ? 'highlighter' : 'pen',
            color: activeSlot.color,
            size: activeSlot.size,
            hasPressure: true,
            ...(isHighlighter ? {} : { brush: activeSlot.brush, penStyle: activeSlot.penStyle }),
          }}
        />
        <ColorPicker colors={isHighlighter ? HIGHLIGHTER_COLORS : PEN_COLORS} value={activeSlot.color} onChange={(c) => props.updateSlot({ color: c })} />
        <SliderRow
          label="Thickness"
          value={activeSlot.size}
          min={range.min}
          max={range.max}
          step={range.step}
          format={(v) => v.toFixed(isHighlighter ? 0 : 1)}
          onChange={(v) => props.updateSlot({ size: v })}
        />
        {!isHighlighter && (
          <>
            <SliderRow label="Opacity" value={brush.opacity} min={0.1} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setStyle({ opacity: v })} />
            <SliderRow label="Pressure" value={brush.thinning} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setStyle({ thinning: v })} />
            {!brush.calligraphy && (
              <SliderRow label="Taper" value={brush.taper} min={0} max={40} step={1} onChange={(v) => setStyle({ taper: v })} />
            )}
            <SliderRow label="Smoothing" value={brush.stabilize} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setStyle({ stabilize: v })} />
          </>
        )}
        <div className="popover-actions">
          {!isHighlighter && activeSlot.penStyle && (
            <button className="link" onClick={() => props.updateSlot({ penStyle: undefined })}>
              Reset to {BRUSHES[activeSlot.brush]?.label ?? 'pen'} defaults
            </button>
          )}
          <button
            className="link danger-text"
            disabled={settings.slots.length <= 1}
            onClick={() => {
              setPopover(null);
              props.removeSlot(activeSlot.id);
            }}
          >
            Remove this pen
          </button>
        </div>
      </div>
    );
  } else if (popover === 'eraser') {
    content = (
      <div className="palette-popover" role="dialog" aria-label="Eraser settings">
        <div className="popover-title">Eraser</div>
        <Segmented
          value={settings.eraserMode}
          options={[
            { value: 'stroke', label: 'Whole stroke' },
            { value: 'partial', label: 'Precise' },
          ]}
          onChange={(v) => update({ eraserMode: v })}
        />
        <SliderRow label="Size" value={settings.eraserSize} min={ERASER_SIZE_RANGE.min} max={ERASER_SIZE_RANGE.max} step={ERASER_SIZE_RANGE.step} onChange={(v) => update({ eraserSize: v })} />
        <Toggle label="Highlighter only" hint="Leaves pen ink untouched" on={!!settings.eraseHighlighterOnly} onChange={(v) => update({ eraseHighlighterOnly: v })} />
        <p className="popover-hint">Pictures and text boxes are never erased. Select them and use Delete.</p>
      </div>
    );
  } else if (popover === 'lasso') {
    const lasso = settings.lasso ?? { mode: 'free' as const, kinds: [] };
    content = (
      <div className="palette-popover" role="dialog" aria-label="Lasso">
        <div className="popover-title">Lasso</div>
        <Segmented
          value={lasso.mode}
          options={[
            { value: 'free', label: 'Freehand' },
            { value: 'rect', label: 'Rectangle' },
          ]}
          onChange={(v) => update({ lasso: { ...lasso, mode: v } })}
        />
        <div className="field-caption">Select only</div>
        <div className="kind-chips">
          {ITEM_KINDS.map(({ kind, label }) => {
            const on = !lasso.kinds.length || lasso.kinds.includes(kind);
            return (
              <button
                key={kind}
                className={`kind-chip ${on ? 'on' : ''}`}
                aria-pressed={on}
                onClick={() => {
                  const current = lasso.kinds.length ? lasso.kinds : ITEM_KINDS.map((k) => k.kind);
                  const next = on ? current.filter((k) => k !== kind) : [...current, kind];
                  // All (or none) ticked means "everything".
                  update({ lasso: { ...lasso, kinds: next.length === ITEM_KINDS.length || !next.length ? [] : next } });
                }}
              >
                {on && <Icon name="check" size={14} />}
                {label}
              </button>
            );
          })}
        </div>
        {props.onSelectAll && (
          <button
            className="popover-wide-button"
            onClick={() => {
              setPopover(null);
              props.onSelectAll?.();
            }}
          >
            Select all on this page
          </button>
        )}
        <p className="popover-hint">
          Circle anything, or tap it, to select it. Drag to move, pull a handle to resize, use the round handle to rotate.
          The menu above the selection changes colour, line style, fill and layering. Tip: tap ink with a finger to select it
          with any tool.
        </p>
      </div>
    );
  } else if (popover === 'text') {
    const t = settings.text;
    const setText = (patch: Partial<typeof t>) => update({ text: { ...t, ...patch } });
    content = (
      <div className="palette-popover wide" role="dialog" aria-label="Text settings">
        <div className="popover-title">Text</div>
        <div className="font-chips">
          {TEXT_FONT_ORDER.map((f) => (
            <button key={f} className={`font-chip ${t.font === f ? 'on' : ''}`} style={{ fontFamily: TEXT_FONTS[f].css }} onClick={() => setText({ font: f })}>
              {TEXT_FONTS[f].label}
            </button>
          ))}
        </div>
        <div className="text-style-row">
          <div className="stepper" aria-label="Text size">
            <button aria-label="Smaller" onClick={() => setText({ size: Math.max(8, t.size - 2) })}>
              <Icon name="minus" size={18} />
            </button>
            <span>{t.size} pt</span>
            <button aria-label="Larger" onClick={() => setText({ size: Math.min(120, t.size + 2) })}>
              <Icon name="plus" size={18} />
            </button>
          </div>
          <div className="segmented compact">
            <button className={t.bold ? 'on' : ''} aria-label="Bold" onClick={() => setText({ bold: !t.bold })}>
              <b>B</b>
            </button>
            <button className={t.italic ? 'on' : ''} aria-label="Italic" onClick={() => setText({ italic: !t.italic })}>
              <i>I</i>
            </button>
            <button className={t.underline ? 'on' : ''} aria-label="Underline" onClick={() => setText({ underline: !t.underline })}>
              <u>U</u>
            </button>
          </div>
          <Segmented
            value={t.align}
            options={(['left', 'center', 'right'] as const).map((a) => ({
              value: a,
              aria: `Align ${a}`,
              label: (
                <svg className="icon" viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d={a === 'left' ? 'M4 6h16M4 10h10M4 14h16M4 18h10' : a === 'center' ? 'M4 6h16M7 10h10M4 14h16M7 18h10' : 'M4 6h16M10 10h10M4 14h16M10 18h10'} />
                </svg>
              ),
            }))}
            onChange={(v) => setText({ align: v })}
          />
        </div>
        <ColorPicker colors={PEN_COLORS} value={t.color} onChange={(c) => setText({ color: c })} label="Text colour" />
        <Toggle label="Highlight behind text" on={!!t.background} onChange={(v) => setText({ background: v ? '#fff3b0' : null })} />
        <p className="popover-hint">Tap the page to start typing. Drag sideways first to choose the box width. Tap a text box with this tool to edit it.</p>
      </div>
    );
  } else if (popover === 'shape') {
    const s = settings.shape;
    const setShape = (patch: Partial<typeof s>) => update({ shape: { ...s, ...patch } });
    content = (
      <div className="palette-popover wide" role="dialog" aria-label="Shape settings">
        <div className="popover-title">Shapes</div>
        <div className="shape-grid">
          {SHAPE_TOOLS.map((shape) => (
            <button
              key={shape.kind}
              className={`shape-chip ${s.kind === shape.kind ? 'on' : ''}`}
              aria-label={shape.label}
              title={shape.label}
              aria-pressed={s.kind === shape.kind}
              onClick={() => setShape({ kind: shape.kind })}
            >
              <ShapeGlyph kind={shape.kind} />
            </button>
          ))}
        </div>
        <div className="field-caption">Border</div>
        <Segmented
          value={s.dash}
          options={[
            { value: null, label: <><DashSample dash={null} /><span>Solid</span></> },
            { value: 'dashed', label: <><DashSample dash="dashed" /><span>Dashed</span></> },
            { value: 'dotted', label: <><DashSample dash="dotted" /><span>Dotted</span></> },
          ]}
          onChange={(v) => setShape({ dash: v })}
        />
        <SliderRow label="Width" value={s.size} min={SHAPE_SIZE_RANGE.min} max={SHAPE_SIZE_RANGE.max} step={SHAPE_SIZE_RANGE.step} format={(v) => v.toFixed(1)} onChange={(v) => setShape({ size: v })} />
        <ColorPicker colors={PEN_COLORS} value={s.color} onChange={(c) => setShape({ color: c })} label="Border colour" />
        <div className="field-caption">Fill</div>
        <div className="color-grid">
          <button className={`color-dot no-fill ${s.fill ? '' : 'selected'}`} aria-label="No fill" onClick={() => setShape({ fill: null })} />
          {PEN_COLORS.slice(0, 8).map((c) => (
            <button key={c} className={`color-dot ${s.fill === c ? 'selected' : ''}`} style={{ background: c }} aria-label={`Fill ${c}`} onClick={() => setShape({ fill: c })} />
          ))}
          <label className="color-dot custom" aria-label="Custom fill">
            <input type="color" value={s.fill ?? '#2f6fde'} onChange={(e) => setShape({ fill: e.target.value })} />
          </label>
        </div>
        {s.fill && (
          <SliderRow label="Fill opacity" value={s.fillOpacity} min={0.05} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setShape({ fillOpacity: v })} />
        )}
        <p className="popover-hint">Drag on the page to draw. Nearly square shapes snap to perfect squares and circles; lines snap every 15°.</p>
      </div>
    );
  } else if (popover === 'tape') {
    const tp = settings.tape;
    content = (
      <div className="palette-popover" role="dialog" aria-label="Tape settings">
        <div className="popover-title">Tape</div>
        <div className="tape-sample" style={{ height: Math.min(48, tp.width), background: tp.color }} />
        <ColorPicker colors={TAPE_COLORS} value={tp.color} onChange={(c) => update({ tape: { ...tp, color: c } })} label="Tape colour" />
        <SliderRow label="Width" value={tp.width} min={TAPE_SIZE_RANGE.min} max={TAPE_SIZE_RANGE.max} step={TAPE_SIZE_RANGE.step} onChange={(v) => update({ tape: { ...tp, width: v } })} />
        <p className="popover-hint">Drag over answers to hide them. Tap the tape (with this tool or a finger) to peek underneath; tap again to cover it.</p>
      </div>
    );
  } else if (popover === 'laser') {
    const p = settings.pointer;
    content = (
      <div className="palette-popover" role="dialog" aria-label="Laser pointer settings">
        <div className="popover-title">Laser pointer</div>
        <ColorPicker colors={LASER_COLORS} value={p.laserColor} onChange={(c) => update({ pointer: { ...p, laserColor: c } })} label="Laser colour" />
        <SliderRow label="Size" value={p.laserSize} min={4} max={30} step={1} onChange={(v) => update({ pointer: { ...p, laserSize: v } })} />
        <Segmented
          value={p.laserTrail}
          options={[
            { value: 0, label: 'Dot only' },
            { value: 900, label: 'Short trail' },
            { value: 2500, label: 'Long trail' },
          ]}
          onChange={(v) => update({ pointer: { ...p, laserTrail: v } })}
        />
        <p className="popover-hint">The laser is never saved. Great for presenting on a shared screen.</p>
      </div>
    );
  } else if (popover === 'more') {
    const p = settings.pointer;
    content = (
      <div className="palette-popover wide" role="dialog" aria-label="Toolbar and Pencil options">
        <div className="popover-title">Toolbar</div>
        <Segmented
          value={style}
          options={[
            { value: 'floating', label: <><Icon name="float" size={18} /> Floating</> },
            { value: 'docked', label: <><Icon name="dock" size={18} /> Docked</> },
          ]}
          onChange={(v) => setLayout({ ...layout, style: v })}
        />
        <Segmented
          value={side}
          options={(['top', 'bottom', 'left', 'right'] as const).map((sd) => ({ value: sd, label: sd[0]!.toUpperCase() + sd.slice(1) }))}
          onChange={(v) => setLayout({ ...layout, side: v })}
        />
        <div className="popover-title">Apple Pencil</div>
        <div className="field-caption">Hover pointer</div>
        <Segmented
          value={p.cursor}
          options={[
            { value: 'dot', label: 'Dot' },
            { value: 'ring', label: 'Ring' },
            { value: 'crosshair', label: 'Crosshair' },
          ]}
          onChange={(v) => update({ pointer: { ...p, cursor: v } })}
        />
        <Toggle label="Hover pointer" hint="Shows where ink will land while the Pencil hovers" on={settings.hoverPreview !== false} onChange={(v) => update({ hoverPreview: v })} />
        <Toggle label="Hover palette" hint="Hold the Pencil still just above the page" on={settings.hoverPalette} onChange={(v) => update({ hoverPalette: v })} />
        <Toggle label="Shape recognition" hint="Hold the Pencil still at the end of a stroke" on={settings.shapeSnap} onChange={(v) => update({ shapeSnap: v })} />
        <Toggle label="Draw with finger" hint="Otherwise fingers scroll and zoom" on={settings.fingerDraws} onChange={(v) => update({ fingerDraws: v })} />
      </div>
    );
  }

  const toolButton = (tool: Exclude<ToolKind, 'pen' | 'highlighter'>, label: string) => {
    const active = settings.tool === tool;
    const color =
      tool === 'text' ? settings.text.color : tool === 'shape' ? settings.shape.color : tool === 'tape' ? settings.tape.color : tool === 'laser' ? settings.pointer.laserColor : '#888';
    return (
      <button
        key={tool}
        className={`pen ${active ? 'active' : ''}`}
        aria-label={label}
        title={label}
        aria-pressed={active}
        onClick={() => {
          if (active) toggle(tool);
          else {
            setPopover(null);
            props.selectTool(tool);
          }
        }}
      >
        <span className="pen-art">
          <PenIcon kind={tool} color={color} />
        </span>
      </button>
    );
  };

  return (
    <div ref={rootRef} className={classes} {...dragProps}>
      {content}
      <div className="palette-row">
        <div className="palette-group">
          <button className="palette-button" aria-label="Undo" title="Undo" disabled={!props.canUndo} onClick={props.undo}>
            <Icon name="undo" size={22} />
          </button>
          <button className="palette-button" aria-label="Redo" title="Redo" disabled={!props.canRedo} onClick={props.redo}>
            <Icon name="redo" size={22} />
          </button>
        </div>

        <div className="pen-tray">
          {settings.slots.map((slot) => {
            const active = penInHand && slot.id === settings.activeSlot;
            return (
              <button
                key={slot.id}
                className={`pen ${active ? 'active' : ''}`}
                aria-label={`${slot.kind === 'highlighter' ? 'Highlighter' : BRUSHES[slot.brush]?.label ?? 'Pen'}, ${slot.color}`}
                aria-pressed={active}
                onClick={() => {
                  if (active) toggle('slot');
                  else {
                    setPopover(null);
                    props.selectSlot(slot.id);
                  }
                }}
              >
                <span className="pen-art">
                  <PenIcon kind={slotIcon(slot)} color={slot.color} />
                </span>
              </button>
            );
          })}
          <button
            className="add-pen"
            aria-label="Add a pen"
            title="Add a pen"
            disabled={settings.slots.length >= MAX_SLOTS}
            onClick={() => {
              props.addSlot();
              setPopover('slot');
            }}
          >
            <Icon name="plus" size={18} />
          </button>
          <span className="tray-divider" />
          {TOOLS.map(({ tool, label }) => toolButton(tool, label))}
        </div>

        <div className="palette-group">
          <button
            className="palette-color"
            aria-label="Pen colour and settings"
            title="Pen settings"
            style={{ background: activeSlot?.color }}
            onClick={() => {
              if (!penInHand && activeSlot) props.selectSlot(activeSlot.id);
              toggle('slot');
            }}
          />
          <button className={`palette-button ${popover === 'more' ? 'on' : ''}`} aria-label="Toolbar and Pencil options" title="Options" onClick={() => toggle('more')}>
            <Icon name="sliders" size={22} />
          </button>
          {style === 'floating' && (
            <button
              className="palette-button"
              aria-label="Minimize tools"
              title="Minimize"
              onClick={() => {
                flipFrom.current = rootRef.current?.getBoundingClientRect() ?? null;
                setPopover(null);
                setMinimized(true);
              }}
            >
              <Icon name={side === 'top' ? 'chevronUp' : side === 'bottom' ? 'chevronDown' : side === 'left' ? 'chevronLeft' : 'chevronRight'} size={22} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
