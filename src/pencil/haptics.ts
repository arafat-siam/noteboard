/**
 * Apple Pencil Pro haptics ("vibration on the pen").
 *
 * Web pages can't make the Pencil buzz, and iPad Safari has no vibration API at all. Inside the
 * Noteboard Shell app (wrapper/NoteboardShell.swiftpm) the native side plays the feedback with
 * UICanvasFeedbackGenerator (iPadOS 17.5+, Apple Pencil Pro). Elsewhere these calls do nothing.
 *
 * Positions are in CSS pixels relative to the viewport (the web view), like clientX/clientY.
 */
export type HapticKind = 'alignment' | 'pathCompleted';

interface HapticHandler {
  postMessage(message: { kind: HapticKind; x: number; y: number }): void;
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: { noteboardHaptic?: HapticHandler } };
  }
}

let last = 0;

export function pencilHaptic(kind: HapticKind, clientX: number, clientY: number): void {
  const handler = typeof window === 'undefined' ? undefined : window.webkit?.messageHandlers?.noteboardHaptic;
  if (!handler) return;
  // Never a constant buzz: at most one tick every 60 ms.
  const now = performance.now();
  if (now - last < 60) return;
  last = now;
  try {
    handler.postMessage({ kind, x: clientX, y: clientY });
  } catch {
    // Haptics are a nicety; never let them disturb drawing.
  }
}
