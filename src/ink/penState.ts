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
