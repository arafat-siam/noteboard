import type { DashStyle } from '../model/types';
import type { ShapeToolKind } from '../ink/shapeTool';

/**
 * The app's line icons (24 × 24, 1.8 px strokes in the current text colour). One set, drawn the
 * same way everywhere, instead of emoji (which look different on every device and aren't
 * professional).
 */
const PATHS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  grid: 'M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM20 20l-4.8-4.8',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  folder: 'M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z',
  folderPlus: 'M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM12 11v5M9.5 13.5h5',
  notebook: 'M6.5 3.5h11a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-11zM6.5 3.5v17M4 7.5h5M4 12h5M4 16.5h5M11 8h5',
  fileImport: 'M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5zM14 3.5v5h5M12 11.5v6M9.5 15l2.5 2.5 2.5-2.5',
  library: 'M5 4.5v15M9.5 4.5v15M14 5.2l4.6 14.1M3.5 19.5h17',
  star: 'm12 3.8 2.5 5.1 5.6.8-4.05 3.95.95 5.6L12 16.6l-5 2.65.95-5.6L3.9 9.7l5.6-.8z',
  clock: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17ZM12 7.5V12l3 2',
  trash: 'M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5',
  tag: 'M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.2 6.2a1.4 1.4 0 0 1-2 0zM8 8h.01',
  lock: 'M6.5 10.5h11a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19v-7a1.5 1.5 0 0 1 1.5-1.5zM8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3',
  shield: 'M12 3.5 5 6v5.5c0 4.3 3 7.7 7 9 4-1.3 7-4.7 7-9V6zM9 12l2.2 2.2L15.5 10',
  cloud: 'M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1-.5 9z',
  cloudCheck: 'M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1-.5 9zM9.5 13.5l2 2 3.5-3.5',
  cloudOff: 'M7 18.5a4.5 4.5 0 0 1-.6-8.96M10 5.6A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1 2.3 8.1M3.5 3.5l17 17',
  sync: 'M19.5 9A7.5 7.5 0 0 0 6 6.6L4.5 8M4.5 4v4h4M4.5 15A7.5 7.5 0 0 0 18 17.4l1.5-1.4M19.5 20v-4h-4',
  pause: 'M8.5 5.5v13M15.5 5.5v13',
  play: 'M7.5 5v14l11-7z',
  warning: 'M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.2h.01',
  chevronRight: 'm9.5 6 6 6-6 6',
  chevronLeft: 'm14.5 6-6 6 6 6',
  chevronDown: 'm6 9.5 6 6 6-6',
  chevronUp: 'm6 14.5 6-6 6 6',
  more: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
  undo: 'M9 7 4 12l5 5M4.5 12H15a5 5 0 0 1 0 10h-2',
  redo: 'm15 7 5 5-5 5M19.5 12H9a5 5 0 0 0 0 10h2',
  tablet: 'M6.5 3h11a1.5 1.5 0 0 1 1.5 1.5v15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3zM11 18h2',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4.9a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.4A7.5 7.5 0 0 0 7 6.4l-2.4-.9-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-.9a7.5 7.5 0 0 0 2.6 1.5l.4 2.4h4l.4-2.4a7.5 7.5 0 0 0 2.6-1.5l2.4.9 2-3.4z',
  text: 'M5 7V5h14v2M12 5v14M9 19h6',
  shapes: 'M9.5 10.5a5 5 0 1 0 0-.01zM13 13.5h7.5V21H13zM16.5 2.5l4 7h-8z',
  tape: 'M4 9.5 14.5 4l5.5 10.5L9.5 20zM6.6 14.5l9-4.8',
  share: 'M12 15V3.5M8 7.5l4-4 4 4M6 11H5a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 5 20h14a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 19 11h-1',
  pages: 'M4 4h7v8H4zM13 4h7v8h-7zM4 14h7v6H4zM13 14h7v6h-7z',
  image: 'M5.5 5h13A2 2 0 0 1 20.5 7v10a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM9 11.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM4 17l5-5 4 4 2.5-2.5L20 18',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
  moon: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z',
  display: 'M4 4.5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1zM8.5 20.5h7M12 16.5v4',
  backspace: 'M8.5 5.5H20a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8.5L3 12zM11.5 9.5l5 5M16.5 9.5l-5 5',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15',
  upload: 'M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 19.5h15',
  pen: 'M15.5 4.5l4 4L8 20H4v-4zM13 7l4 4',
  eraser: 'M8.5 20 3.6 15.1a1.5 1.5 0 0 1 0-2.1L13 3.6a1.5 1.5 0 0 1 2.1 0l5.3 5.3a1.5 1.5 0 0 1 0 2.1L11.5 20zM8 9l7 7M8.5 20H20',
  sliders: 'M5 4v6M5 14v6M12 4v9M12 17v3M19 4v3M19 11v9M3 10h4M10 17h4M17 7h4',
  dock: 'M4 4.5h16a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM3 8.5h18',
  float: 'M4 4.5h16a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM7.5 7.5h9v3h-9z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className, filled }: { name: IconName; size?: number; className?: string; filled?: boolean }) {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** A short sample of a line style (solid, dashed, dotted). */
export function DashSample({ dash }: { dash: DashStyle | null }) {
  return (
    <svg className="dash-sample" viewBox="0 0 40 8" aria-hidden="true">
      <path
        d="M3 4h34"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap={dash === 'dotted' ? 'round' : 'butt'}
        strokeDasharray={dash === 'dashed' ? '7 4.5' : dash === 'dotted' ? '0.1 5' : undefined}
      />
    </svg>
  );
}

const SHAPE_GLYPHS: Record<ShapeToolKind, string> = {
  line: 'M4 20 20 4',
  arrow: 'M4 20 20 4M11 4h9v9',
  doubleArrow: 'M4 20 20 4M12 4h8v8M12 20H4v-8',
  rectangle: 'M3.5 6h17v12h-17z',
  roundedRect: 'M7 6h10a3.5 3.5 0 0 1 3.5 3.5v5A3.5 3.5 0 0 1 17 18H7a3.5 3.5 0 0 1-3.5-3.5v-5A3.5 3.5 0 0 1 7 6z',
  ellipse: 'M12 18.5c4.7 0 8.5-2.9 8.5-6.5S16.7 5.5 12 5.5 3.5 8.4 3.5 12s3.8 6.5 8.5 6.5z',
  triangle: 'M12 4 21 19.5H3z',
  rightTriangle: 'M4 4v15.5h16z',
  diamond: 'M12 3 21 12l-9 9-9-9z',
  parallelogram: 'M8 6h13l-5 12H3z',
  pentagon: 'M12 3.5 20.5 9.7l-3.2 10H6.7l-3.2-10z',
  hexagon: 'M7.5 4.5h9L21 12l-4.5 7.5h-9L3 12z',
  star: 'm12 3.5 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 17l-5.3 2.9 1.2-6L3.4 9.8l6-.7z',
};

export function ShapeGlyph({ kind }: { kind: ShapeToolKind }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={22} height={22} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
      <path d={SHAPE_GLYPHS[kind]} />
    </svg>
  );
}
