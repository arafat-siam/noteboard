/**
 * Apple Pencil double-tap / squeeze never reach Safari. An optional native wrapper app
 * (WKWebView) can forward them by calling `window.noteboardPencil('doubleTap' | 'squeeze')`.
 * In a normal browser nothing calls it, and the app works without it.
 */
export type PencilGesture = 'doubleTap' | 'squeeze';

declare global {
  interface Window {
    noteboardPencil?: (gesture: PencilGesture) => void;
  }
}

const EVENT = 'noteboard-pencil';

window.noteboardPencil = (gesture) => {
  window.dispatchEvent(new CustomEvent<PencilGesture>(EVENT, { detail: gesture }));
};

export function onPencilGesture(handler: (gesture: PencilGesture) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<PencilGesture>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
