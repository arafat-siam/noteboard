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
  /** Pencil barrel roll in degrees (0 if the browser doesn't report it). */
  twist: number;
  /** Direction the Pencil leans, in radians (undefined if unknown). */
  azimuth?: number;
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
  const width = highlighter ? Math.max(4, style.size * 0.35) : style.size;
  const height = style.size;
  // Highlighter chisel: barrel roll if reported, otherwise follow the lean direction.
  const angle = highlighter ? (style.twist ? style.twist : style.azimuth !== undefined ? (style.azimuth * 180) / Math.PI : 0) : 0;
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
