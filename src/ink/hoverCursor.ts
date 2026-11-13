/**
 * The Pencil hover cursor. There is exactly ONE for the whole app (one element on top of the
 * page), so it can never double up between pages or flicker as pages re-render.
 *
 * - pens: a dot the size and colour of the ink
 * - highlighter: a soft square the size and colour of the highlighter
 * - eraser: a ring showing what it will erase
 *
 * Why it is built this way (the pointer used to look doubled while moving and to tremble):
 *
 * 1. A hovering Pencil is tracked less precisely than a touching one, so its position carries
 *    small random noise. Shown raw, the dot trembles. Positions go through a "One Euro" filter:
 *    heavy smoothing when slow or still (no tremble), almost none when fast (no lag).
 * 2. Pointer events don't arrive in step with the screen. Moving the dot inside the event
 *    handler made its steps uneven. It now moves once per drawn frame, to where the Pencil is
 *    at that frame.
 * 3. Safari draws web pages ~60 times a second on the iPad's 120 Hz screen, so every position
 *    stayed up for two screen refreshes; the eye, following the dot, sees that as two dots. The
 *    system compositor does run at 120 Hz, so each step is handed to it as a one-frame glide
 *    (CSS transition): the screen then shows a new position on every refresh.
 * 4. Only `transform` changes per frame. Size, colour and shape are written when they change.
 */
import { glideDuration, HoverTracker } from './hoverTracker';

export interface HoverCursorStyle {
  tool: 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'laser';
  /** Diameter in CSS pixels. */
  size: number;
  color: string;
}

/** Set to false to turn off the 120 Hz glide (point 3 above) if it ever misbehaves. */
const GLIDE = true;

let el: HTMLDivElement | null = null;
let hideTimer: number | null = null;
let raf: number | null = null;
let visible = false;
/** What is currently written to the element, to skip writes that change nothing. */
let appliedLook = '';
let appliedX = NaN;
let appliedY = NaN;
let appliedGlide = -1;
let size = 0;
const tracker = new HoverTracker();
/** Smoothed time between drawn frames (ms): tells a 60 fps page from a 120 fps one. */
let frameMs = 16.7;
let lastFrame = 0;

function element(): HTMLDivElement {
  if (!el) {
    el = document.createElement('div');
    el.className = 'hover-cursor';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
  return el;
}

function frame(now: number): void {
  raf = null;
  if (!visible || !el) return;
  if (lastFrame) {
    const dt = now - lastFrame;
    if (dt > 4 && dt < 50) frameMs += (dt - frameMs) * 0.1;
  }
  lastFrame = now;

  const p = tracker.at(now);
  const x = p.x - size / 2;
  const y = p.y - size / 2;
  if (Number.isNaN(appliedX) || Math.abs(x - appliedX) > 0.04 || Math.abs(y - appliedY) > 0.04) {
    // First frame after appearing: jump there. Afterwards glide for exactly one drawn frame.
    const glide = GLIDE && !Number.isNaN(appliedX) ? glideDuration(frameMs) : 0;
    if (glide !== appliedGlide) {
      el.style.transition = glide ? `transform ${glide}ms linear` : 'none';
      appliedGlide = glide;
    }
    el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    appliedX = x;
    appliedY = y;
  }
  // Keep going while the Pencil is moving or the dot is still settling; then rest (no idle loop).
  if (p.moving) raf = requestAnimationFrame(frame);
  else lastFrame = 0;
}

/** Feeds the cursor a Pencil hover event; it is drawn on the next frame. */
export function showHoverCursor(event: PointerEvent, style: HoverCursorStyle): void {
  const cursor = element();
  if (style.tool === 'lasso') {
    hideHoverCursor();
    return;
  }

  const background =
    style.tool === 'pen' ? style.color : style.tool === 'laser' ? '#ff3b30' : style.tool === 'highlighter' ? `${style.color}80` : 'transparent';
  const look = `${style.tool}|${style.size}|${background}`;
  if (look !== appliedLook) {
    appliedLook = look;
    size = style.size;
    cursor.className = `hover-cursor ${style.tool}`;
    cursor.style.width = `${size}px`;
    cursor.style.height = `${size}px`;
    cursor.style.background = background;
    appliedX = NaN; // the size changed, so the offset did too
  }

  // Every digitizer sample since the last event, with its own time (steadier speed estimate).
  const samples = event.getCoalescedEvents?.() ?? [];
  for (const s of samples.length ? samples : [event]) tracker.add(s.clientX, s.clientY, s.timeStamp || performance.now());

  if (!visible) {
    visible = true;
    appliedX = NaN;
    cursor.style.display = 'block';
  }
  if (raf == null) raf = requestAnimationFrame(frame);

  // Safety net only: hide if hover events stop entirely (e.g. no "leave" event when the Pencil
  // is lifted away). Long enough that holding the Pencil still never hides it.
  if (hideTimer != null) clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hideHoverCursor, 4000);
}

export function hideHoverCursor(): void {
  if (hideTimer != null) clearTimeout(hideTimer);
  hideTimer = null;
  if (raf != null) cancelAnimationFrame(raf);
  raf = null;
  lastFrame = 0;
  tracker.reset();
  if (visible && el) el.style.display = 'none';
  visible = false;
}
