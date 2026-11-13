import { describe, expect, it } from 'vitest';
import { glideDuration, HoverTracker } from './hoverTracker';

/** Deterministic noise in [-1, 1]. */
function noise(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
}

describe('HoverTracker', () => {
  it('holds still when the Pencil is still but its samples are noisy', () => {
    const tracker = new HoverTracker();
    const rand = noise(7);
    let t = 1000;
    const shown: number[] = [];
    for (let i = 0; i < 240; i++) {
      tracker.add(300 + rand() * 0.6, 200 + rand() * 0.6, t);
      t += 1000 / 120;
      if (i > 60 && i % 2 === 0) shown.push(tracker.at(t).x);
    }
    const spread = Math.max(...shown) - Math.min(...shown);
    expect(spread).toBeLessThan(0.35); // raw spread is 1.2 px
    expect(Math.abs(shown[shown.length - 1]! - 300)).toBeLessThan(0.3);
  });

  it('keeps up with a fast move (little lag)', () => {
    const tracker = new HoverTracker();
    let t = 0;
    let x = 0;
    for (let i = 0; i < 120; i++) {
      x = i * 10; // 1200 px/s
      tracker.add(x, 50, t);
      t += 1000 / 120;
    }
    const p = tracker.at(t);
    expect(Math.abs(p.x - x)).toBeLessThan(12); // about one frame of travel
    expect(p.y).toBeCloseTo(50, 1);
  });

  it('moves in even steps when events arrive unevenly', () => {
    const tracker = new HoverTracker();
    const rand = noise(3);
    const speed = 0.6; // px per ms
    let frame = 16.7;
    let eventTime = 0;
    const steps: number[] = [];
    let last: number | null = null;
    for (let f = 0; f < 90; f++, frame += 16.7) {
      // Samples every ~8.3 ms, each arriving up to 6 ms early or late.
      while (eventTime < frame) {
        const at = eventTime + rand() * 3;
        tracker.add(at * speed, 0, at);
        eventTime += 8.3;
      }
      const x = tracker.at(frame).x;
      if (last != null && f > 30) steps.push(x - last);
      last = x;
    }
    const ideal = speed * 16.7;
    for (const step of steps) expect(Math.abs(step - ideal)).toBeLessThan(ideal * 0.25);
  });

  it('settles exactly on the Pencil once it stops, and stops asking for frames', () => {
    const tracker = new HoverTracker();
    let t = 0;
    for (let i = 0; i < 60; i++, t += 8) tracker.add(i * 6, 0, t);
    for (let i = 0; i < 80; i++, t += 8) tracker.add(354, 0, t);
    expect(tracker.at(t).x).toBeCloseTo(354, 0);
    expect(tracker.at(t + 400).moving).toBe(false);
    expect(tracker.at(t + 400).x).toBeCloseTo(354, 0);
  });

  it('comes to rest exactly on the last sample when samples simply stop', () => {
    const tracker = new HoverTracker();
    let t = 0;
    for (let i = 0; i < 40; i++, t += 8) tracker.add(100 + i * 6, 150, t);
    const last = 100 + 39 * 6;
    const during = tracker.at(t).x;
    expect(Math.abs(during - last)).toBeLessThan(8);
    expect(tracker.at(t + 400).x).toBeCloseTo(last, 1);
    expect(tracker.at(t + 400).moving).toBe(false);
    // …and carries on from there without jumping back.
    tracker.add(last + 0.2, 150, t + 500);
    expect(tracker.at(t + 500).x).toBeCloseTo(last, 0);
  });

  it('starts afresh after the Pencil leaves and comes back elsewhere', () => {
    const tracker = new HoverTracker();
    tracker.add(10, 10, 0);
    tracker.add(12, 10, 8);
    tracker.add(500, 400, 900);
    expect(tracker.at(900)).toMatchObject({ x: 500, y: 400 });
  });
});

describe('glideDuration', () => {
  it('glides for one frame at 60 fps and not at all at 120 fps', () => {
    expect(glideDuration(16.7)).toBe(17);
    expect(glideDuration(8.3)).toBe(0);
    expect(glideDuration(60)).toBe(34);
  });
});
