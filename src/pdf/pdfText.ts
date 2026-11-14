/** Working with the text of imported PDF pages: copy a line, and highlights that snap to text. */
import type { PdfTextRun } from '../db/db';

interface Line {
  runs: PdfTextRun[];
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Groups text runs into lines (runs whose vertical middles are close), top to bottom. */
export function textLines(runs: PdfTextRun[]): Line[] {
  const sorted = [...runs].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2) || a.x - b.x);
  const lines: Line[] = [];
  for (const r of sorted) {
    const mid = r.y + r.height / 2;
    const line = lines.find((l) => Math.abs((l.y0 + l.y1) / 2 - mid) < Math.max(2, Math.min(r.height, l.y1 - l.y0) * 0.5));
    if (line) {
      line.runs.push(r);
      line.x0 = Math.min(line.x0, r.x);
      line.x1 = Math.max(line.x1, r.x + r.width);
      line.y0 = Math.min(line.y0, r.y);
      line.y1 = Math.max(line.y1, r.y + r.height);
    } else lines.push({ runs: [r], x0: r.x, x1: r.x + r.width, y0: r.y, y1: r.y + r.height });
  }
  for (const l of lines) l.runs.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => a.y0 - b.y0);
}

const lineText = (l: Line) =>
  l.runs
    .map((r) => r.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The text line under a point (with a little slack), or null. */
export function lineAt(runs: PdfTextRun[], x: number, y: number): string | null {
  const line = textLines(runs).find((l) => y >= l.y0 - 3 && y <= l.y1 + 3 && x >= l.x0 - 20 && x <= l.x1 + 20);
  return line ? lineText(line) : null;
}

/** All the text on the page, line by line. */
export function pageTextFromRuns(runs: PdfTextRun[]): string {
  return textLines(runs).map(lineText).join('\n');
}

/** The text inside a rectangle (page units), line by line. */
export function textInRect(runs: PdfTextRun[], rect: { x: number; y: number; width: number; height: number }): string {
  const inside = runs.filter((r) => {
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    return cx >= rect.x && cx <= rect.x + rect.width && cy >= rect.y && cy <= rect.y + rect.height;
  });
  return textLines(inside).map(lineText).join('\n');
}

/** Splits a run into words, placed by character count (close enough for highlighting). */
export function words(run: PdfTextRun): PdfTextRun[] {
  const out: PdfTextRun[] = [];
  const n = run.str.length || 1;
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(run.str))) {
    out.push({ ...run, str: m[0], x: run.x + (run.width * m.index) / n, width: (run.width * m[0].length) / n });
  }
  return out.length ? out : [run];
}

/**
 * A text-aware highlighter: a roughly horizontal highlighter stroke over PDF text becomes one
 * straight band per text line it crosses, exactly as tall as the line and only as long as the
 * text. Returns null when the stroke isn't over text (then it stays as drawn).
 */
export function snapHighlight(points: number[], size: number, runs: PdfTextRun[]): { x0: number; x1: number; y: number; height: number }[] | null {
  if (!runs.length || points.length < 6) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    minX = Math.min(minX, points[i]!);
    maxX = Math.max(maxX, points[i]!);
    minY = Math.min(minY, points[i + 1]!);
    maxY = Math.max(maxY, points[i + 1]!);
  }
  const dx = maxX - minX;
  const dy = maxY - minY;
  if (dx < 12 || dy > Math.max(dx * 0.35, size * 1.2)) return null; // not a sideways swipe
  const half = size / 2;
  const bands: { x0: number; x1: number; y: number; height: number }[] = [];
  for (const line of textLines(runs)) {
    // The swipe must cross the line's middle.
    const mid = (line.y0 + line.y1) / 2;
    if (mid < minY - half || mid > maxY + half) continue;
    const x0 = Math.max(minX, line.x0);
    const x1 = Math.min(maxX, line.x1);
    if (x1 - x0 < 4) continue;
    // Snap the ends to the words they touch (a run may hold a whole line).
    const touched = line.runs.flatMap(words).filter((r) => r.x + r.width > x0 && r.x < x1);
    if (!touched.length) continue;
    bands.push({
      x0: Math.min(...touched.map((r) => r.x)),
      x1: Math.max(...touched.map((r) => r.x + r.width)),
      y: mid,
      height: (line.y1 - line.y0) * 1.15,
    });
  }
  return bands.length ? bands : null;
}
