/** Pen illustrations, standing upright with the tip showing the ink colour (Apple Notes style). */
export type PenIconKind =
  | 'fountain'
  | 'ballpoint'
  | 'pencil'
  | 'brush'
  | 'fineliner'
  | 'marker'
  | 'calligraphy'
  | 'crayon'
  | 'highlighter'
  | 'eraser'
  | 'lasso'
  | 'laser'
  | 'text'
  | 'shape'
  | 'tape';

export function PenIcon({ kind, color }: { kind: PenIconKind; color: string }) {
  const body = '#f6f6f8';
  const edge = 'rgba(0,0,0,0.16)';
  switch (kind) {
    case 'fineliner':
      return (
        <svg viewBox="0 0 30 76" aria-hidden="true">
          <rect x="8" y="24" width="14" height="52" rx="3" fill={body} stroke={edge} />
          <path d="M10 25 L13.5 12 L16.5 12 L20 25 Z" fill={body} stroke={edge} />
          <rect x="14" y="4" width="2" height="9" rx="1" fill={color} />
          <rect x="8" y="40" width="14" height="5" fill={color} />
        </svg>
      );
    case 'marker':
      return (
        <svg viewBox="0 0 30 76" aria-hidden="true">
          <rect x="5" y="26" width="20" height="50" rx="5" fill={body} stroke={edge} />
          <path d="M8 27 L10 14 L20 14 L22 27 Z" fill="#d4d4d9" stroke={edge} />
          <path d="M11 14.5 L12 6 L18 6 L19 14.5 Z" fill={color} />
          <rect x="5" y="44" width="20" height="9" fill={color} />
        </svg>
      );
    case 'calligraphy':
      return (
        <svg viewBox="0 0 30 76" aria-hidden="true">
          <rect x="8" y="30" width="14" height="46" rx="3" fill="#3b2f2a" />
          <path d="M8 31 L9 14 L21 14 L22 31 Z" fill="#c9a24a" stroke={edge} />
          <path d="M9.5 14.5 L13 4 L21 4 L20.5 14.5 Z" fill={color} />
        </svg>
      );
    case 'crayon':
      return (
        <svg viewBox="0 0 30 76" aria-hidden="true">
          <rect x="7" y="26" width="16" height="50" rx="2" fill={color} />
          <rect x="7" y="36" width="16" height="22" fill="#ffffff" opacity="0.55" />
          <path d="M7 27 L11 9 L19 9 L23 27 Z" fill={color} />
          <path d="M11 9 L13 4 L17 4 L19 9 Z" fill={color} opacity="0.8" />
        </svg>
      );
    case 'text':
      return (
        <svg viewBox="0 0 30 76" aria-hidden="true">
          <rect x="4" y="16" width="22" height="22" rx="5" fill={body} stroke={edge} />
          <path d="M9.5 22h11M15 22v11" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
          <rect x="10" y="40" width="10" height="36" rx="3" fill={body} stroke={edge} />
        </svg>
      );
    case 'shape':
      return (
        <svg viewBox="0 0 30 76" aria-hidden="true">
          <rect x="3" y="12" width="24" height="26" rx="5" fill={body} stroke={edge} />
          <circle cx="12" cy="20" r="5.2" fill="none" stroke={color} strokeWidth="2" />
          <rect x="14" y="23" width="9" height="9" rx="1.2" fill={color} opacity="0.85" />
          <rect x="10" y="40" width="10" height="36" rx="3" fill={body} stroke={edge} />
        </svg>
      );
    case 'tape':
      return (
        <svg viewBox="0 0 30 76" aria-hidden="true">
          <circle cx="15" cy="22" r="12" fill={color} />
          <circle cx="15" cy="22" r="5" fill={body} stroke={edge} />
          <rect x="2" y="32" width="26" height="8" rx="1" fill={color} opacity="0.85" />
          <rect x="10" y="44" width="10" height="32" rx="3" fill={body} stroke={edge} />
        </svg>
      );
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
    case 'laser':
      return (
        <svg viewBox="0 0 30 76" aria-hidden="true">
          <rect x="8" y="22" width="14" height="54" rx="7" fill="#2b2b30" />
          <rect x="12" y="40" width="6" height="9" rx="2" fill="#ff3b30" />
          <circle cx="15" cy="12" r="7" fill="#ff3b30" opacity="0.25" />
          <circle cx="15" cy="12" r="3.6" fill="#ff3b30" />
        </svg>
      );
    case 'lasso':
      return (
        <svg viewBox="0 0 30 76" aria-hidden="true">
          <rect x="7" y="28" width="16" height="48" rx="4" fill={body} stroke={edge} />
          <ellipse cx="15" cy="15" rx="10.5" ry="8.5" fill="none" stroke="#637381" strokeWidth="2.2" strokeDasharray="3.2 2.2" />
        </svg>
      );
  }
}
