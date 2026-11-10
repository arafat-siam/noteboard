import { useEffect, useRef } from 'react';
import type { ToolKind, ToolSettings } from '../ink/InkPage';

interface Props {
  x: number;
  y: number;
  settings: ToolSettings;
  penColors: string[];
  highlighterColors: string[];
  onSelect: (patch: Partial<ToolSettings>) => void;
  onClose: () => void;
}

const TOOLS: [ToolKind, string, string][] = [
  ['pen', '✒️', 'Pen'],
  ['highlighter', '🖍️', 'Highlighter'],
  ['eraser', '🩹', 'Eraser'],
  ['lasso', '➰', 'Lasso'],
];

/** How long the hovering Pencil rests on an item before it is chosen (no touch needed). */
const DWELL_MS = 280;
const TOOL_RADIUS = 62;
const COLOR_RADIUS = 112;

/**
 * Radial tool palette that opens where the Pencil hovers still. Pick an item by hovering
 * over it briefly or by tapping it — the closest a web app can get to Pencil Pro squeeze.
 */
export function QuickPalette({ x, y, settings, penColors, highlighterColors, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const dwell = useRef<number | null>(null);

  const cx = Math.min(Math.max(x, COLOR_RADIUS + 24), window.innerWidth - COLOR_RADIUS - 24);
  const cy = Math.min(Math.max(y, COLOR_RADIUS + 24), window.innerHeight - COLOR_RADIUS - 24);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose(); // the stroke still happens
    };
    const onMove = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - cx, e.clientY - cy) > COLOR_RADIUS + 70) onClose();
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

  const choose = (patch: Partial<ToolSettings>) => {
    onSelect(patch);
    onClose();
  };

  const hoverProps = (patch: Partial<ToolSettings>) => ({
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType !== 'pen' || e.buttons !== 0) return;
      if (dwell.current != null) clearTimeout(dwell.current);
      dwell.current = window.setTimeout(() => choose(patch), DWELL_MS);
    },
    onPointerLeave: () => {
      if (dwell.current != null) clearTimeout(dwell.current);
      dwell.current = null;
    },
    onClick: () => choose(patch),
  });

  const colorTool = settings.tool === 'highlighter' ? 'highlighter' : 'pen';
  const colors = colorTool === 'highlighter' ? highlighterColors : penColors;
  const current = colorTool === 'highlighter' ? settings.highlighterColor : settings.color;
  const place = (angleDeg: number, radius: number) => {
    const a = (angleDeg * Math.PI) / 180;
    return { left: cx + radius * Math.cos(a), top: cy + radius * Math.sin(a) };
  };

  return (
    <div ref={ref} className="quick-palette" role="menu" aria-label="Quick tools">
      <div className="quick-ring" style={{ left: cx, top: cy, width: COLOR_RADIUS * 2 + 44, height: COLOR_RADIUS * 2 + 44 }} />
      {TOOLS.map(([tool, icon, label], i) => (
        <button
          key={tool}
          role="menuitem"
          aria-label={label}
          className={`quick-item tool ${settings.tool === tool ? 'active' : ''}`}
          style={place(-90 + i * 90, TOOL_RADIUS)}
          {...hoverProps({ tool })}
        >
          {icon}
        </button>
      ))}
      {colors.map((color, i) => (
        <button
          key={color}
          role="menuitem"
          aria-label={`Color ${color}`}
          className={`quick-item color ${color === current && settings.tool === colorTool ? 'active' : ''}`}
          style={{ ...place(-90 + (i + 0.5) * (360 / colors.length), COLOR_RADIUS), background: color }}
          {...hoverProps(colorTool === 'highlighter' ? { tool: 'highlighter', highlighterColor: color } : { tool: 'pen', color })}
        />
      ))}
    </div>
  );
}
