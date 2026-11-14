import { describe, expect, it } from 'vitest';
import { lineAt, snapHighlight, textInRect } from './pdfText';

// Two lines of text: "The cell is" + "the unit" on line 1, "of life." on line 2.
const runs = [
  { str: 'The cell is', x: 100, y: 100, width: 80, height: 12 },
  { str: 'the unit', x: 185, y: 100.5, width: 55, height: 12 },
  { str: 'of life.', x: 100, y: 120, width: 45, height: 12 },
];

describe('PDF text', () => {
  it('reads the line under a point and the text inside a rectangle', () => {
    expect(lineAt(runs, 150, 106)).toBe('The cell is the unit');
    expect(lineAt(runs, 150, 300)).toBeNull();
    expect(textInRect(runs, { x: 90, y: 90, width: 200, height: 50 })).toBe('The cell is the unit\nof life.');
  });

  it('snaps a sideways highlighter swipe to the words of the line it crosses', () => {
    const swipe = [110, 108, 0.5, 150, 104, 0.5, 200, 109, 0.5];
    expect(snapHighlight(swipe, 14, runs)).toEqual([{ x0: 100, x1: 205.625, y: 106.25, height: expect.closeTo(14.375, 3) }]);
    // A short swipe in the middle of a long run covers only the words it touches.
    const long = [{ str: 'aaaa bbbb cccc dddd', x: 0, y: 0, width: 190, height: 10 }];
    const band = snapHighlight([55, 5, 0.5, 95, 5, 0.5], 10, long)![0]!;
    expect([band.x0, band.x1]).toEqual([50, 90]);
    // Up-and-down scribbles and strokes away from text stay as drawn.
    expect(snapHighlight([110, 100, 0.5, 115, 200, 0.5, 120, 300, 0.5], 14, runs)).toBeNull();
    expect(snapHighlight([110, 400, 0.5, 200, 402, 0.5], 14, runs)).toBeNull();
  });
});
