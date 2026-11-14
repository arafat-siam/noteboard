import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ToolKind, ToolSettings } from '../ink/InkPage';
import { BRUSHES } from '../ink/brushes';
import { HIGHLIGHTER_COLORS, PEN_COLORS, type PenSlot } from '../ink/palette';
import { PenIcon, type PenIconKind } from './PenIcon';
import { slotIcon } from './ToolPalette';
import { Icon } from './Icon';

interface Props {
  x: number;
  y: number;
  settings: ToolSettings;
  selectSlot: (id: string) => void;
  selectTool: (tool: ToolKind) => void;
  /** Changes the pen in hand (colour, size). */
  updateSlot: (patch: Partial<PenSlot>) => void;
  undo: () => void;
  redo: () => void;
  onClose: () => void;
}

/** Gap between the palette's pointer and the Pencil tip. */
const GAP = 14;
const PEN_SIZES = [1.2, 2.5, 4.5];
const HIGHLIGHTER_SIZES = [12, 20, 32];
const mm = (units: number) => `${((units * 25.4) / 96).toFixed(1)} mm`;

type Entry = { key: string; label: string; icon: { kind: PenIconKind; color: string }; active: boolean; choose: () => void };

/**
 * Compact palette just above the Pencil tip (hover-hold, or squeeze in the shell app), in the
 * spirit of Apple Notes: undo/redo, the pens of the current preset in the toolbar's order (the
 * pen in hand stands raised; the row scrolls when there are many), eraser and lasso, a colour
 * well, then quick colours and three sizes for the pen in hand. Choose by touching an item with
 * the Pencil or a finger (hovering never chooses).
 */
export function QuickPalette({ x, y, settings, selectSlot, selectTool, updateSlot, undo, redo, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; below: boolean; arrow: number } | null>(null);

  // Above the tip when there is room, otherwise below; never past the screen edges.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const below = y - GAP - h < 70;
    const left = Math.min(Math.max(x - w / 2, 10), window.innerWidth - w - 10);
    const top = below ? y + GAP : y - GAP - h;
    setPlace({ left, top, below, arrow: Math.min(Math.max(x - left, 22), w - 22) });
  }, [x, y]);

  // Keep the pen in hand in view when the row scrolls.
  useLayoutEffect(() => {
    stripRef.current?.querySelector<HTMLElement>('.qp-tool.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, []);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose(); // the stroke still happens
    };
    const onMove = (e: PointerEvent) => {
      const r = panelRef.current?.getBoundingClientRect();
      if (!r) return;
      // Moving the hovering Pencil well away closes it.
      const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
      const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
      if (Math.hypot(dx, dy) > 120) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const penInHand = settings.tool === 'pen' || settings.tool === 'highlighter';
  const activeSlot = settings.slots.find((s) => s.id === settings.activeSlot) ?? settings.slots[0];
  const isHighlighter = activeSlot?.kind === 'highlighter';

  // Same order as the toolbar (drag pens there to reorder; saved in the toolbar preset).
  const pens: Entry[] = settings.slots.map((slot) => ({
      key: slot.id,
      label: slot.kind === 'highlighter' ? 'Highlighter' : (BRUSHES[slot.brush]?.label ?? 'Pen'),
      icon: { kind: slotIcon(slot), color: slot.color },
      active: penInHand && slot.id === settings.activeSlot,
      choose: () => selectSlot(slot.id),
  }));
  // Always visible, outside the scrolling pen row.
  const fixed: Entry[] = [
    { key: 'eraser', label: 'Eraser', icon: { kind: 'eraser', color: '#888' }, active: settings.tool === 'eraser', choose: () => selectTool('eraser') },
    { key: 'lasso', label: 'Lasso', icon: { kind: 'lasso', color: '#888' }, active: settings.tool === 'lasso', choose: () => selectTool('lasso') },
  ];

  const pick = (choose: () => void, close = true) => {
    choose();
    if (close) onClose();
  };
  // Chosen only by touching (Pencil or finger): hovering never picks, so the pen row can scroll.
  const hoverPick = (choose: () => void, close = true) => ({ onClick: () => pick(choose, close) });

  // Colour and size apply to the pen in hand (and put it in hand if another tool was).
  const setPen = (patch: Partial<PenSlot>) => {
    if (!activeSlot) return;
    if (!penInHand) selectSlot(activeSlot.id);
    updateSlot(patch);
  };
  const colours = (isHighlighter ? HIGHLIGHTER_COLORS : PEN_COLORS).slice(0, 6);
  const sizes = isHighlighter ? HIGHLIGHTER_SIZES : PEN_SIZES;
  const nearestSize = sizes.reduce((best, s) => (Math.abs(s - (activeSlot?.size ?? 0)) < Math.abs(best - (activeSlot?.size ?? 0)) ? s : best), sizes[0]!);

  const toolButton = (t: Entry) => (
    <button key={t.key} role="menuitem" aria-label={t.label} aria-pressed={t.active} className={`qp-tool${t.active ? ' active' : ''}`} {...hoverPick(t.choose)}>
      <span className="qp-pen">
        <PenIcon {...t.icon} />
      </span>
    </button>
  );

  return (
    <div ref={ref} className="quick-palette" role="menu" aria-label="Quick tools">
      <div
        ref={panelRef}
        className={`qp-panel${place?.below ? ' below' : ''}`}
        style={place ? { left: place.left, top: place.top, ['--arrow' as string]: `${place.arrow}px` } : { left: -9999, top: 0 }}
      >
        <div className="qp-top">
          <div className="qp-history">
            <button className="qp-icon" aria-label="Undo" onClick={undo}>
              <Icon name="undo" size={18} />
            </button>
            <button className="qp-icon" aria-label="Redo" onClick={redo}>
              <Icon name="redo" size={18} />
            </button>
          </div>
          <div className="qp-strip" ref={stripRef}>
            {pens.map((t) => toolButton(t))}
          </div>
          <div className="qp-fixed">{fixed.map((t) => toolButton(t))}</div>
          <label className="qp-well" aria-label="More colours" title="More colours">
            <span className="qp-well-dot" style={{ background: activeSlot?.color }} />
            <input type="color" value={activeSlot?.color ?? '#000000'} onChange={(e) => setPen({ color: e.target.value })} />
          </label>
        </div>
        <div className="qp-bottom">
          <div className="qp-colours">
            {colours.map((c) => (
              <button
                key={c}
                className={`qp-colour${activeSlot?.color.toLowerCase() === c.toLowerCase() ? ' on' : ''}`}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
                {...hoverPick(() => setPen({ color: c }), false)}
              />
            ))}
          </div>
          <span className="qp-divider" />
          <div className="qp-sizes">
            {sizes.map((s, i) => (
              <button
                key={s}
                className={`qp-size${s === nearestSize ? ' on' : ''}`}
                aria-label={['Thin', 'Medium', 'Thick'][i]}
                {...hoverPick(() => setPen({ size: s }), false)}
              >
                <span style={{ width: 4 + i * 3, height: 4 + i * 3 }} />
              </button>
            ))}
          </div>
          <span className="qp-size-label">{activeSlot ? mm(activeSlot.size) : ''}</span>
        </div>
      </div>
    </div>
  );
}
