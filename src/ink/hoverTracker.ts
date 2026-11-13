/**
 * Turns noisy, unevenly timed Pencil hover samples into a steady position per drawn frame.
 * Pure maths (no DOM), so it can be tested. See hoverCursor.ts for why it exists.
 */

/** Smoothing when still: lower = steadier but slower to follow tiny moves (Hz). */
const MIN_CUTOFF = 1.2;
/** How quickly smoothing lets go as the Pencil speeds up (Hz per px/s). */
const BETA = 0.04;
/** Apparent speed that is just hover noise, ignored when easing the smoothing (px/s). */
const NOISE_SPEED = 25;
/** Smoothing of the speed estimate itself (Hz). */
const SPEED_CUTOFF = 4;
/** A gap this long between samples means the Pencil left and came back: start afresh (ms). */
const RESTART_MS = 120;
/** Look ahead at most this far from the last sample to the frame being drawn (ms). */
const MAX_LEAD_MS = 10;
/** With no new sample for this long the Pencil has stopped: the look-ahead fades out (ms). */
const LEAD_FADE_MS = 40;
/**
 * A Pencil held perfectly still sends no more samples. After this long without one (ms), the
 * cursor closes the last bit of smoothing lag and comes to rest exactly on the last sample …
 */
const SETTLE_AFTER_MS = 30;
/** … this quickly (ms, time constant). */
const SETTLE_MS = 40;

const alpha = (dtSeconds: number, cutoffHz: number) => 1 / (1 + 1 / (2 * Math.PI * cutoffHz * dtSeconds));

export class HoverTracker {
  private has = false;
  private rawX = 0;
  private rawY = 0;
  /** Filtered position. */
  private x = 0;
  private y = 0;
  /** Smoothed raw speed, px/s (drives how much smoothing is applied). */
  private dx = 0;
  private dy = 0;
  /** Velocity of the filtered position, px/ms (for the look-ahead). */
  private vx = 0;
  private vy = 0;
  private t = 0;

  reset(): void {
    this.has = false;
  }

  /** Adds a sample (CSS px, time in ms on the performance.now() clock). */
  add(x: number, y: number, time: number): void {
    if (!this.has || time - this.t > RESTART_MS || time < this.t - RESTART_MS) {
      this.has = true;
      this.rawX = this.x = x;
      this.rawY = this.y = y;
      this.dx = this.dy = this.vx = this.vy = 0;
      this.t = time;
      return;
    }
    // Coming out of a pause: start from where the cursor came to rest.
    const settled = this.settle(time);
    this.x = this.rawX + (this.x - this.rawX) * settled;
    this.y = this.rawY + (this.y - this.rawY) * settled;
    this.vx *= settled;
    this.vy *= settled;
    // Samples that share a timestamp (or arrive out of order) still count, as one digitizer tick.
    const dtMs = Math.max(time - this.t, 1000 / 240);
    const dt = dtMs / 1000;
    const aSpeed = alpha(dt, SPEED_CUTOFF);
    this.dx += ((x - this.rawX) / dt - this.dx) * aSpeed;
    this.dy += ((y - this.rawY) / dt - this.dy) * aSpeed;
    this.rawX = x;
    this.rawY = y;
    const a = alpha(dt, MIN_CUTOFF + BETA * Math.max(0, Math.hypot(this.dx, this.dy) - NOISE_SPEED));
    const nx = this.x + (x - this.x) * a;
    const ny = this.y + (y - this.y) * a;
    this.vx += ((nx - this.x) / dtMs - this.vx) * 0.5;
    this.vy += ((ny - this.y) / dtMs - this.vy) * 0.5;
    this.x = nx;
    this.y = ny;
    this.t = Math.max(this.t, time);
  }

  /** 1 while samples keep coming; falls to 0 as a pause goes on. */
  private settle(now: number): number {
    return Math.exp(-Math.max(0, now - this.t - SETTLE_AFTER_MS) / SETTLE_MS);
  }

  /**
   * Where to draw the cursor for the frame at `now`, and whether it is still moving (so the
   * caller keeps drawing frames).
   */
  at(now: number): { x: number; y: number; moving: boolean } {
    const age = Math.max(0, now - this.t);
    const fade = Math.min(1, Math.max(0, 1 - (age - MAX_LEAD_MS) / LEAD_FADE_MS));
    const lead = Math.min(age, MAX_LEAD_MS) * fade;
    const settled = this.settle(now);
    return {
      x: this.rawX + (this.x - this.rawX) * settled + this.vx * lead,
      y: this.rawY + (this.y - this.rawY) * settled + this.vy * lead,
      moving: age < SETTLE_AFTER_MS + SETTLE_MS * 6,
    };
  }
}

/**
 * How long each cursor step should glide (ms), given the measured time between drawn frames.
 * A page drawn at ~60 fps glides for one frame so a 120 Hz screen shows in-between positions;
 * a page already drawn at 100+ fps needs no help.
 */
export function glideDuration(frameMs: number): number {
  return frameMs > 12 ? Math.round(Math.min(frameMs, 34)) : 0;
}
