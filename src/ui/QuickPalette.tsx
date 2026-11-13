import { useEffect, useRef } from 'react';
import type { ToolKind, ToolSettings } from '../ink/InkPage';
import { BRUSHES } from '../ink/brushes';
import { PenIcon } from './PenIcon';
import { slotIcon } from './ToolPalette';
import { Icon } from './Icon';

interface Props {
  x: number;
  y: number;
  settings: ToolSettings;
  selectSlot: (id: string) => void;
  selectTool: (tool: ToolKind) => void;
  undo: () => void;
  redo: () => void;
  onClose: () => void;
}

/** How long the hovering Pencil rests on an item before it is chosen (no touch needed). */
const DWELL_MS = 260;
const RING_RADIUS = 108;
const DISC_RADIUS = 152;

type Entry = { key: string; label: string; icon: Parameters<typeof PenIcon>[0]; active: boolean; choose: () => void };

/**
 * Circular palette under the Pencil tip (squeeze in the shell app, or hover-hold): your pens,
 * eraser and lasso around the ring, undo/redo in the middle. Pick by hovering or tapping.
 */
export function QuickPalette({ x, y, settings, selectSlot, selectTool, undo, redo, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const dwell = useRef<number | null>(null);

  const cx = Math.min(Math.max(x, DISC_RADIUS + 12), window.innerWidth - DISC_RADIUS - 12);
  const cy = Math.min(Math.max(y, DISC_RADIUS + 12), window.innerHeight - DISC_RADIUS - 12);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose(); // the stroke still happens
    };
    const onMove = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - cx, e.clientY - cy) > DISC_RADIUS + 90) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('keydown', onKey);
      if (dwell.current != null) clearTimeout(dwell.current);
    };
  }, [cx, cy, onClose]);

  const penInHand = settings.tool === 'pen' || settings.tool === 'highlighter';
  const entries: Entry[] = [
    ...settings.slots.map((slot) => ({
      key: slot.id,
      label: slot.kind === 'highlighter' ? 'Highlighter' : BRUSHES[slot.brush]?.label ?? 'Pen',
      icon: { kind: slotIcon(slot), color: slot.color },
      active: penInHand && slot.id === settings.activeSlot,
      choose: () => selectSlot(slot.id),
    })),
    { key: 'eraser', label: 'Eraser', icon: { kind: 'eraser', color: '#888' }, active: settings.tool === 'eraser', choose: () => selectTool('eraser') },
    { key: 'lasso', label: 'Lasso', icon: { kind: 'lasso', color: '#888' }, active: settings.tool === 'lasso', choose: () => selectTool('lasso') },
    { key: 'text', label: 'Text', icon: { kind: 'text', color: settings.text.color }, active: settings.tool === 'text', choose: () => selectTool('text') },
    { key: 'shape', label: 'Shapes', icon: { kind: 'shape', color: settings.shape.color }, active: settings.tool === 'shape', choose: () => selectTool('shape') },
    { key: 'tape', label: 'Tape', icon: { kind: 'tape', color: settings.tape.color }, active: settings.tool === 'tape', choose: () => selectTool('tape') },
    { key: 'laser', label: 'Laser pointer', icon: { kind: 'laser', color: settings.pointer.laserColor }, active: settings.tool === 'laser', choose: () => selectTool('laser') },
  ];

  const pick = (choose: () => void) => {
    choose();
    onClose();
  };

  const hoverPick = (choose: () => void) => ({
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType !== 'pen' || e.buttons !== 0) return;
      if (dwell.current != null) clearTimeout(dwell.current);
      dwell.current = window.setTimeout(() => pick(choose), DWELL_MS);
    },
    onPointerLeave: () => {
      if (dwell.current != null) clearTimeout(dwell.current);
      dwell.current = null;
    },
    onClick: () => pick(choose),
  });

  const activeColor = settings.slots.find((s) => s.id === settings.activeSlot)?.color ?? '#000';

  return (
    <div ref={ref} className="quick-palette" role="menu" aria-label="Quick tools">
      <div className="quick-disc" style={{ left: cx, top: cy, width: DISC_RADIUS * 2, height: DISC_RADIUS * 2 }} />
      {entries.map((entry, i) => {
        const angle = -90 + (i * 360) / entries.length;
        const a = (angle * Math.PI) / 180;
        return (
          <button
            key={entry.key}
            role="menuitem"
            aria-label={entry.label}
            className={`quick-item ${entry.active ? 'active' : ''}`}
            style={{ left: cx + RING_RADIUS * Math.cos(a), top: cy + RING_RADIUS * Math.sin(a) }}
            {...hoverPick(entry.choose)}
          >
            {/* Pens point outward, like tools arranged around a dial. */}
            <span className="quick-pen" style={{ transform: `rotate(${angle + 90}deg)` }}>
              <PenIcon {...entry.icon} />
            </span>
          </button>
        );
      })}
      <div className="quick-center" style={{ left: cx, top: cy }}>
        <button aria-label="Undo" className="quick-action" onClick={undo}>
          <Icon name="undo" size={20} />
        </button>
        <span className="quick-color" style={{ background: activeColor }} />
        <button aria-label="Redo" className="quick-action" onClick={redo}>
          <Icon name="redo" size={20} />
        </button>
      </div>
    </div>
  );
}
