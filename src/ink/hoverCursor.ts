/**
 * The Pencil hover cursor. There is exactly ONE for the whole app (one element on top of the
 * page), so it can never double up between pages or flicker as pages re-render.
 *
 * - pens: a dot the size and colour of the ink
 * - highlighter: a soft square the size and colour of the highlighter
 * - eraser: a ring showing what it will erase
 */
export interface HoverCursorStyle {
  tool: 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'laser';
  /** Diameter in CSS pixels. */
  size: number;
  color: string;
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
  const size = style.size;
  cursor.className = `hover-cursor ${style.tool}`;
  cursor.style.display = 'block';
  cursor.style.width = `${size}px`;
  cursor.style.height = `${size}px`;
  cursor.style.background =
    style.tool === 'pen' ? style.color : style.tool === 'laser' ? '#ff3b30' : style.tool === 'highlighter' ? `${style.color}80` : 'transparent';
  cursor.style.transform = `translate(${clientX - size / 2}px, ${clientY - size / 2}px)`;

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
