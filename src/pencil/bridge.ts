/**
 * Apple Pencil double-tap / squeeze never reach Safari. The Noteboard Shell app
 * (wrapper/NoteboardShell.swiftpm) receives them natively and calls
 * `window.noteboardPencil(gesture, {x, y})`, where x/y is the hovering Pencil position in
 * CSS pixels (null if unknown). In a normal browser nothing calls it.
 */
export type PencilGesture = 'doubleTap' | 'squeeze';

export interface PencilGestureEvent {
  gesture: PencilGesture;
  point: { x: number; y: number } | null;
}

declare global {
  interface Window {
    noteboardPencil?: (gesture: PencilGesture, point?: { x: number; y: number } | null) => void;
    /** Present when running inside the Noteboard Shell app. */
    noteboardShell?: { version: number };
  }
}

const EVENT = 'noteboard-pencil';

window.noteboardPencil = (gesture, point) => {
  window.dispatchEvent(new CustomEvent<PencilGestureEvent>(EVENT, { detail: { gesture, point: point ?? null } }));
};

export function onPencilGesture(handler: (event: PencilGestureEvent) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<PencilGestureEvent>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

export function inShellApp(): boolean {
  return typeof window !== 'undefined' && !!window.noteboardShell;
}
