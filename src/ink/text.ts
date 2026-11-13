import { newId, type Stroke, type TextContent, type TextFont } from '../model/types';
import type { Point } from './geometry';

/**
 * Text boxes. The text is laid out in its own box (width × height page units) and that box is
 * mapped onto the stroke's 4 corners, like a picture. Moving, resizing and rotating the corners
 * therefore moves, scales and rotates the text with no special cases.
 */

export const TEXT_FONTS: Record<TextFont, { label: string; css: string }> = {
  sans: { label: 'Sans', css: '-apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif' },
  serif: { label: 'Serif', css: 'ui-serif, "New York", Georgia, "Times New Roman", serif' },
  rounded: { label: 'Rounded', css: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", sans-serif' },
  mono: { label: 'Mono', css: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
  hand: { label: 'Handwritten', css: 'Noteworthy, "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive' },
};
export const TEXT_FONT_ORDER: TextFont[] = ['sans', 'serif', 'rounded', 'mono', 'hand'];
export const TEXT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];
export const DEFAULT_TEXT_WIDTH = 320;

export const LINE_HEIGHT = 1.3;
export const paddingFor = (size: number) => Math.max(2, size * 0.3);

export function cssFont(t: Pick<TextContent, 'font' | 'size' | 'bold' | 'italic'>, size = t.size): string {
  return `${t.italic ? 'italic ' : ''}${t.bold ? '700 ' : '400 '}${size}px ${TEXT_FONTS[t.font]?.css ?? TEXT_FONTS.sans.css}`;
}

type Measure = (text: string) => number;

/** Splits text into lines that fit `maxWidth` (word wrap; very long words are broken). */
export function layoutLines(content: string, maxWidth: number, measure: Measure): string[] {
  const out: string[] = [];
  for (const paragraph of content.split('\n')) {
    const words = paragraph.split(/(\s+)/).filter((w) => w.length);
    let line = '';
    for (const word of words) {
      const candidate = line + word;
      if (!line || measure(candidate) <= maxWidth) {
        if (!line && measure(word) > maxWidth && !/^\s+$/.test(word)) {
          // A word longer than the box: break it by characters.
          let piece = '';
          for (const ch of word) {
            if (piece && measure(piece + ch) > maxWidth) {
              out.push(piece);
              piece = '';
            }
            piece += ch;
          }
          line = piece;
        } else {
          line = candidate;
        }
      } else {
        out.push(line.trimEnd());
        line = /^\s+$/.test(word) ? '' : word;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer(font: string): Measure {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  const ctx = measureCtx!;
  ctx.font = font;
  return (s) => ctx.measureText(s).width;
}

/** Lines of a text box, as drawn. */
export function textLines(t: TextContent): string[] {
  const pad = paddingFor(t.size);
  return layoutLines(t.content, Math.max(t.size, t.width - pad * 2), measurer(cssFont(t)));
}

/** Height the box needs for its text. */
export function measureTextHeight(t: Omit<TextContent, 'height'>): number {
  const lines = textLines({ ...t, height: 0 });
  return Math.max(1, lines.length) * t.size * LINE_HEIGHT + paddingFor(t.size) * 2;
}

/** The 4 corners: top-left, top-right, bottom-right, bottom-left. */
export function boxCorners(stroke: Stroke): [Point, Point, Point, Point] {
  const p = stroke.points;
  return [0, 1, 2, 3].map((i) => ({ x: p[i * 3] ?? 0, y: p[i * 3 + 1] ?? 0 })) as [Point, Point, Point, Point];
}

/** A new text box with its top-left corner at `at`. */
export function makeTextStroke(at: Point, text: Omit<TextContent, 'height'>, color: string, createdAt = Date.now()): Stroke {
  const height = measureTextHeight(text);
  const { x, y } = at;
  const w = text.width;
  return {
    id: newId(),
    tool: 'text',
    color,
    size: 0,
    hasPressure: false,
    points: [x, y, 0, x + w, y, 0, x + w, y + height, 0, x, y + height, 0],
    text: { ...text, height },
    createdAt,
  };
}

/**
 * The same text box with new text or formatting (new id; same place, size factor, rotation and
 * layer). The box grows or shrinks downwards to fit the text.
 */
export function retextStroke(stroke: Stroke, patch: Partial<TextContent>, color: string, id = newId()): Stroke {
  const old = stroke.text!;
  const next = { ...old, ...patch };
  const height = measureTextHeight(next);
  const [tl, tr, , bl] = boxCorners(stroke);
  // Per page unit of the box's own height, how far down the corners go (keeps scale and rotation).
  const vx = (bl.x - tl.x) / (old.height || 1);
  const vy = (bl.y - tl.y) / (old.height || 1);
  const ux = (tr.x - tl.x) / (old.width || 1);
  const uy = (tr.y - tl.y) / (old.width || 1);
  const w = next.width;
  const p = (u: number, v: number) => [tl.x + ux * u + vx * v, tl.y + uy * u + vy * v, 0];
  return {
    ...stroke,
    id,
    color,
    text: { ...next, height },
    points: [...p(0, 0), ...p(w, 0), ...p(w, height), ...p(0, height)],
  };
}

/** Draws a text box (in page units, onto its corners). */
export function drawTextStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const t = stroke.text;
  if (!t) return;
  const [tl, tr, , bl] = boxCorners(stroke);
  const w = t.width || 1;
  const h = t.height || 1;
  ctx.save();
  ctx.transform((tr.x - tl.x) / w, (tr.y - tl.y) / w, (bl.x - tl.x) / h, (bl.y - tl.y) / h, tl.x, tl.y);
  if (t.background) {
    ctx.fillStyle = t.background;
    ctx.beginPath();
    ctx.roundRect?.(0, 0, w, h, Math.min(8, t.size * 0.3)) ?? ctx.rect(0, 0, w, h);
    ctx.fill();
  }
  const pad = paddingFor(t.size);
  ctx.font = cssFont(t);
  ctx.fillStyle = stroke.color;
  ctx.textBaseline = 'alphabetic';
  const align = t.align ?? 'left';
  ctx.textAlign = align;
  const x = align === 'left' ? pad : align === 'center' ? w / 2 : w - pad;
  const lines = textLines(t);
  const lineH = t.size * LINE_HEIGHT;
  lines.forEach((line, i) => {
    const baseline = pad + i * lineH + t.size * 1.0;
    ctx.fillText(line, x, baseline);
    if (t.underline && line) {
      const lw = ctx.measureText(line).width;
      const x0 = align === 'left' ? x : align === 'center' ? x - lw / 2 : x - lw;
      ctx.fillRect(x0, baseline + t.size * 0.12, lw, Math.max(0.6, t.size * 0.06));
    }
  });
  ctx.restore();
}
