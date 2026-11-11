/**
 * The Pencil hover cursor. There is exactly ONE for the whole app (one element on top of the
 * page), so it can never double up between pages or flicker as pages re-render.
 *
 * - pens: a dot the size and colour of the ink
 * - highlighter: a soft square the size and colour of the highlighter
 * - eraser: a ring showing what it will erase
 *
 * Safari redraws web pages ~60 times a second on the iPad's 120 Hz screen, so a small sharp dot
 * that moves fast is seen twice (a faded "second pointer" trailing behind — it isn't in screen
 * recordings because it only exists in the eye). To avoid it, the cursor is motion-aware:
 * it stretches along the direction of travel (the two images merge into one streak) and fades
 * when moving fast, then returns to a crisp dot as the Pencil slows down to aim.
 */
export interface HoverCursorStyle {
  tool: 'pen' | 'highlighter' | 'eraser' | 'lasso';
  /** Diameter in CSS pixels. */
  size: number;
  color: string;
}

let el: HTMLDivElement | null = null;
let hideTimer: number | null = null;
let last: { x: number; y: number; t: number } | null = null;
/** Smoothed speed in CSS px per millisecond. */
let speed = 0;
let heading = 0;

/** Below this speed the cursor is a plain, fully visible dot. */
const CALM_SPEED = 0.25;
/** At and above this speed the cursor is nearly invisible. */
const FAST_SPEED = 1.6;
/** One displayed frame at ~60 fps: how far the Pencil moves between two drawn positions. */
const FRAME_MS = 16.7;

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

  // Track how fast and in which direction the Pencil is moving.
  const now = performance.now();
  if (last) {
    const dt = Math.max(1, now - last.t);
    const dx = clientX - last.x;
    const dy = clientY - last.y;
    const instant = Math.hypot(dx, dy) / dt;
    // Quick to react when speeding up, gentle when slowing down (no popping).
    speed = instant > speed ? speed * 0.4 + instant * 0.6 : speed * 0.8 + instant * 0.2;
    if (Math.hypot(dx, dy) > 0.5) heading = Math.atan2(dy, dx);
    if (dt > 120) speed = instant; // resumed after a pause
  }
  last = { x: clientX, y: clientY, t: now };

  const size = style.size;
  // Stretch by roughly the distance travelled in one displayed frame, so consecutive images
  // overlap into a single streak instead of two separate dots.
  const stretch = speed > CALM_SPEED ? Math.min(60, speed * FRAME_MS) : 0;
  const width = size + stretch;
  const fade = Math.min(1, Math.max(0, (speed - CALM_SPEED) / (FAST_SPEED - CALM_SPEED)));
  const opacity = 1 - fade * 0.85;
  const radius = style.tool === 'highlighter' ? '3px' : `${size / 2}px`;

  cursor.className = `hover-cursor ${style.tool}`;
  cursor.style.display = 'block';
  cursor.style.width = `${width}px`;
  cursor.style.height = `${size}px`;
  cursor.style.borderRadius = radius;
  cursor.style.opacity = opacity.toFixed(2);
  cursor.style.background =
    style.tool === 'pen' ? style.color : style.tool === 'highlighter' ? `${style.color}80` : 'transparent';
  // The streak trails behind the tip: its front end sits on the Pencil.
  const angle = stretch ? heading : 0;
  const centreX = clientX - Math.cos(angle) * (stretch / 2);
  const centreY = clientY - Math.sin(angle) * (stretch / 2);
  cursor.style.transform = `translate(${centreX - width / 2}px, ${centreY - size / 2}px) rotate(${angle}rad)`;

  // Safety net only: hide if hover events stop entirely (e.g. no "leave" event when the Pencil
  // is lifted away). Long enough that holding the Pencil still never hides it.
  if (hideTimer != null) clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hideHoverCursor, 4000);
}

export function hideHoverCursor(): void {
  if (hideTimer != null) clearTimeout(hideTimer);
  hideTimer = null;
  last = null;
  speed = 0;
  if (el) el.style.display = 'none';
}
