/** Pen illustrations, standing upright with the tip showing the ink colour (Apple Notes style). */
export type PenIconKind = 'fountain' | 'ballpoint' | 'pencil' | 'brush' | 'highlighter' | 'eraser' | 'lasso';

export function PenIcon({ kind, color }: { kind: PenIconKind; color: string }) {
  const body = '#f6f6f8';
  const edge = 'rgba(0,0,0,0.16)';
  switch (kind) {
    case 'fountain':
      return (
        <svg viewBox="0 0 30 76" aria-hidden="true">
          <rect x="6" y="28" width="18" height="48" rx="4" fill="#2b2b30" />
          <path d="M8 29 L15 4 L22 29 Z" fill="#d9b45a" stroke={edge} />
          <path d="M15 4 L13.2 15 L16.8 15 Z" fill={color} />
          <rect x="6" y="42" width="18" height="6" fill={color} />
        </svg>
      );
    case 'ballpoint':
      return (
        <svg viewBox="0 0 30 76" aria-hidden="true">
          <rect x="7" y="26" width="16" height="50" rx="4" fill={body} stroke={edge} />
          <path d="M9 27 L15 6 L21 27 Z" fill={body} stroke={edge} />
          <circle cx="15" cy="7.5" r="2.4" fill={color} />
          <rect x="7" y="44" width="16" height="7" fill={color} />
        </svg>
      );
    case 'pencil':
      return (
        <svg viewBox="0 0 30 76" aria-hidden="true">
          <rect x="7" y="26" width="16" height="50" fill="#f2c14e" stroke={edge} />
          <rect x="12.5" y="26" width="5" height="50" fill="#e3a92b" />
          <path d="M7 27 L15 4 L23 27 Z" fill="#f3d9a8" stroke={edge} />
          <path d="M12 13 L15 4 L18 13 Z" fill={color} />
        </svg>
      );
    case 'brush':
      return (
        <svg viewBox="0 0 30 76" aria-hidden="true">
          <rect x="9" y="32" width="12" height="44" rx="3" fill="#8d6e63" />
          <rect x="8" y="25" width="14" height="9" rx="1" fill="#c4c4ca" />
          <path d="M8 26 C8 15 15 2 15 2 C15 2 22 15 22 26 Z" fill={color} />
        </svg>
      );
    case 'highlighter':
      return (
        <svg viewBox="0 0 30 76" aria-hidden="true">
          <rect x="5" y="28" width="20" height="48" rx="4" fill={body} stroke={edge} />
          <path d="M7 29 L9 11 L21 6 L23 29 Z" fill={color} />
          <rect x="5" y="48" width="20" height="7" fill={color} />
        </svg>
      );
    case 'eraser':
      return (
        <svg viewBox="0 0 30 76" aria-hidden="true">
          <rect x="5" y="30" width="20" height="46" rx="4" fill={body} stroke={edge} />
          <rect x="5" y="8" width="20" height="24" rx="5" fill="#f4a3b4" stroke={edge} />
        </svg>
      );
    case 'lasso':
      return (
        <svg viewBox="0 0 30 76" aria-hidden="true">
          <rect x="7" y="28" width="16" height="48" rx="4" fill={body} stroke={edge} />
          <ellipse cx="15" cy="15" rx="10.5" ry="8.5" fill="none" stroke="#2f6fde" strokeWidth="2.2" strokeDasharray="3.2 2.2" />
        </svg>
      );
  }
}
