/**
 * Tells the editor that a finger tap on a page did something (selected ink, followed a link,
 * peeked under tape, jumped a recording), so it isn't also an "empty space" tap that hides
 * the bars.
 */
let handledAt = -Infinity;

export function noteTapHandled(): void {
  handledAt = performance.now();
}

/** A page handled a tap within the last `ms` milliseconds. */
export function tapHandledWithin(ms: number): boolean {
  return performance.now() - handledAt < ms;
}
