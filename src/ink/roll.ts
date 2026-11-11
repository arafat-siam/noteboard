import { DEFAULT_NIB_ANGLE } from './chisel';
import { diagnostics } from './diagnostics';

/**
 * Where the Apple Pencil Pro barrel-roll angle comes from:
 *  1. Safari's PointerEvent.twist, if it ever reports it;
 *  2. the Noteboard Shell app, which reads it natively and calls window.noteboardPencilRoll;
 *  3. otherwise a fixed, natural highlighter angle.
 */
declare global {
  interface Window {
    noteboardPencilRoll?: (radians: number) => void;
  }
}

let shellRoll: { radians: number; at: number } | null = null;
let twistSeen = false;

if (typeof window !== 'undefined') {
  window.noteboardPencilRoll = (radians) => {
    shellRoll = { radians, at: performance.now() };
    diagnostics.twist = Math.round((radians * 180) / Math.PI);
  };
}

/** Current chisel-tip angle (radians) for a Pencil event. */
export function nibAngle(e: Pick<PointerEvent, 'twist'>): number {
  if (e.twist) twistSeen = true;
  if (twistSeen) return DEFAULT_NIB_ANGLE + ((e.twist || 0) * Math.PI) / 180;
  if (shellRoll && performance.now() - shellRoll.at < 1500) return DEFAULT_NIB_ANGLE + shellRoll.radians;
  return DEFAULT_NIB_ANGLE;
}
