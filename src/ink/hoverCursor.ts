/**
 * The Pencil hover cursor. There is exactly ONE for the whole app (one element on top of the
 * page), so it can never double up between pages or flicker as pages re-render.
 *
 * - pens: a dot the size and colour of the ink
 * - highlighter: a chisel tip that turns with the Pencil's tilt direction and barrel roll
 * - eraser: a ring showing what it will erase
 */
export interface HoverCursorStyle {
  tool: 'pen' | 'highlighter' | 'eraser' | 'lasso';
  /** Diameter in CSS pixels. */
  size: number;
  color: string;
  /** Highlighter chisel-tip angle in radians (follows barrel roll when known). */
  angle: number;
}

let el: HTMLDivElement | null = null;
let hideTimer: number | null = null;

function element(): HTMLDivElement {
  if (!el) {
    el = document.createElement('div');
    el.className = 'hover-cursor';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
  return el;
}

export function showHoverCursor(clientX: number, clientY: number, style: HoverCursorStyle): void {
  const cursor = element();
  if (style.tool === 'lasso') {
    cursor.style.display = 'none';
    return;
  }
  const highlighter = style.tool === 'highlighter';
  // Highlighter: the chisel tip itself (long side along the tip angle).
  const width = style.size;
  const height = highlighter ? Math.max(3, style.size * 0.22) : style.size;
  const angle = highlighter ? (style.angle * 180) / Math.PI : 0;
  cursor.className = `hover-cursor ${style.tool}`;
  cursor.style.display = 'block';
  cursor.style.width = `${width}px`;
  cursor.style.height = `${height}px`;
  cursor.style.background =
    style.tool === 'pen' ? style.color : highlighter ? `${style.color}99` : 'transparent';
  cursor.style.transform = `translate(${clientX - width / 2}px, ${clientY - height / 2}px) rotate(${angle}deg)`;

  // Safety net only: hide if hover events stop entirely (e.g. no "leave" event when the Pencil
  // is lifted away). Long enough that holding the Pencil still never hides it.
  if (hideTimer != null) clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hideHoverCursor, 4000);
}

export function hideHoverCursor(): void {
  if (hideTimer != null) clearTimeout(hideTimer);
  hideTimer = null;
  if (el) el.style.display = 'none';
}
