/**
 * Shared Pencil state for palm rejection: while the Pencil is on (or just left) the screen,
 * finger/palm contacts must neither draw nor scroll the page.
 */
let lastPenActivity = 0;
let penDown = false;

export function notePen(down?: boolean): void {
  lastPenActivity = performance.now();
  if (down !== undefined) penDown = down;
}

export function penActiveWithin(ms: number): boolean {
  return penDown || performance.now() - lastPenActivity < ms;
}

/** Pencil hovering above the screen (no contact): used to keep background work out of the way. */
let lastHover = 0;

export function noteHover(): void {
  lastHover = performance.now();
}

export function hoveredWithin(ms: number): boolean {
  return performance.now() - lastHover < ms;
}
