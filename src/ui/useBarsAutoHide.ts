import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { isControl } from '../ink/InkPage';
import { tapHandledWithin } from '../ink/tapSignal';

/** A finger touch at most this long, that moved less than TAP_SLOP px, is a tap. */
const TAP_MS = 300;
const TAP_SLOP = 10;
const SLIDE_MS = 200;

/** While any of these is open, a tap only closes or clears it (it never hides the bars). */
const BUSY = '.selection-box, .canvas-menu, .palette-popover, .quick-palette, .text-editor.open, .modal-backdrop';
/** Taps on these are never "empty space". */
const NOT_EMPTY = '.tool-palette, .editor-top, .guide-layer, .selection-box, [data-handle]';

/**
 * Drawboard-style "tap empty space to hide the bars": calls `onTap` for a single-finger tap
 * inside `scrollerRef` that didn't land on ink, a link, tape or a control, and wasn't just
 * closing a menu or clearing a selection. Pinches, scrolls and long presses don't count.
 */
export function useEmptySpaceTap(enabled: boolean, scrollerRef: RefObject<HTMLElement | null>, onTap: () => void) {
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;

  useEffect(() => {
    if (!enabled) return;
    const touches = new Set<number>();
    let tap: { id: number; x: number; y: number; t: number; busy: boolean } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.add(e.pointerId);
      if (touches.size > 1) {
        tap = null; // a pinch or two-finger gesture
        return;
      }
      const target = e.target as Element | null;
      const scroller = scrollerRef.current;
      if (!scroller || !target?.closest || !scroller.contains(target) || isControl(target) || target.closest(NOT_EMPTY)) {
        tap = null;
        return;
      }
      // Checked when the finger lands, before the tap closes anything.
      tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), busy: !!document.querySelector(BUSY) };
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.delete(e.pointerId);
      const t = tap;
      if (!t || t.id !== e.pointerId) return;
      tap = null;
      if (t.busy || performance.now() - t.t > TAP_MS || Math.hypot(e.clientX - t.x, e.clientY - t.y) > TAP_SLOP) return;
      // The page used the tap (selected ink, followed a link, peeked under tape…).
      if (tapHandledWithin(500)) return;
      onTapRef.current();
    };
    const onCancel = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (tap?.id === e.pointerId) tap = null; // scrolling cancels the touch
    };

    // Capture for "down" (to see what was open before anything closes); bubble for "up" so the
    // page has already handled its own tap.
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel, true);
    };
  }, [enabled, scrollerRef]);
}

/**
 * Slides the top bar up out of view and then removes it from the layout (so the pages get the
 * room), or brings it back. The bar stays mounted (a recording in its button keeps going). The
 * scroll position is shifted by the bar's height so the page doesn't jump.
 */
export function useSlideAwayBar(hidden: boolean, barRef: RefObject<HTMLElement | null>, scrollerRef: RefObject<HTMLElement | null>) {
  const shownAs = useRef(hidden);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || shownAs.current === hidden) return;
    shownAs.current = hidden;
    const scroller = scrollerRef.current;
    if (hidden) {
      const anim = bar.animate(
        [
          { transform: 'translateY(0)', opacity: 1 },
          { transform: 'translateY(-100%)', opacity: 0 },
        ],
        { duration: SLIDE_MS, easing: 'ease-in', fill: 'forwards' },
      );
      // A timer, not onfinish: animations don't advance while the page is in the background.
      const timer = window.setTimeout(() => {
        const h = bar.offsetHeight;
        bar.style.display = 'none';
        anim.cancel();
        if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollTop - h);
      }, SLIDE_MS);
      return () => {
        window.clearTimeout(timer);
        anim.cancel();
      };
    }
    if (bar.style.display === 'none') {
      bar.style.display = '';
      if (scroller) scroller.scrollTop += bar.offsetHeight;
    }
    bar.animate(
      [
        { transform: 'translateY(-100%)', opacity: 0 },
        { transform: 'translateY(0)', opacity: 1 },
      ],
      { duration: SLIDE_MS, easing: 'ease-out' },
    );
    return undefined;
  }, [hidden, barRef, scrollerRef]);
}
