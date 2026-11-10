/**
 * Live Pencil/rendering measurements, shown on screen when "Pencil diagnostics" is on.
 * Lets the user report exact numbers from a real iPad (we can't attach a Pencil to CI).
 */
export const diagnostics = {
  enabled: false,
  pointerType: '-',
  pressure: 0,
  coalescedSupported: false,
  predictedSupported: false,
  /** Pointer events received in the last second. */
  eventsPerSecond: 0,
  /** Digitizer samples (incl. coalesced) in the last second — ~240/s means full Pencil rate. */
  samplesPerSecond: 0,
  /** Average ms to draw one live frame. */
  frameMs: 0,
  /** Time from the newest Pencil sample to it being drawn. */
  inputToDrawMs: 0,
  canvasPixels: 0,
  devicePixelRatio: 1,
  cancels: 0,
  /** 'yes' once the Pencil has been seen hovering (iPad Pro M2+ with Pencil 2 / Pro). */
  hover: 'not seen',
  tilt: '-',
  /** Barrel roll would show here if Safari reported it (PointerEvent.twist). */
  twist: 0,
};

let events = 0;
let samples = 0;
let frameTotal = 0;
let frames = 0;
let windowStart = performance.now();

export function recordEvent(sampleCount: number): void {
  events += 1;
  samples += sampleCount;
  roll();
}

export function recordFrame(ms: number, inputAgeMs: number): void {
  frameTotal += ms;
  frames += 1;
  diagnostics.inputToDrawMs = Math.round(inputAgeMs * 10) / 10;
  roll();
}

function roll(): void {
  const now = performance.now();
  if (now - windowStart < 1000) return;
  const secs = (now - windowStart) / 1000;
  diagnostics.eventsPerSecond = Math.round(events / secs);
  diagnostics.samplesPerSecond = Math.round(samples / secs);
  diagnostics.frameMs = frames ? Math.round((frameTotal / frames) * 10) / 10 : 0;
  events = samples = frames = frameTotal = 0;
  windowStart = now;
}
