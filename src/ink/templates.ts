import type { CSSProperties } from 'react';
import type { PaperTemplate } from '../model/types';

export const TEMPLATE_LABELS: Record<PaperTemplate, string> = {
  blank: 'Blank',
  ruled: 'Ruled',
  grid: 'Grid',
  dotted: 'Dotted',
  cornell: 'Cornell notes',
  music: 'Music staff',
  isometric: 'Isometric',
};

/** A line of a drawn template, in page units; `strong` = the margin colour. */
export type TemplateLine = [x1: number, y1: number, x2: number, y2: number, strong?: boolean];

/**
 * Templates drawn from lines that depend on the page size (Cornell, music, isometric). The same
 * lines draw the screen background (as SVG) and the PDF / PNG exports.
 */
export function templateLines(template: PaperTemplate, width: number, height: number): TemplateLine[] | null {
  const m = TEMPLATE_METRICS;
  const out: TemplateLine[] = [];
  if (template === 'cornell') {
    // Cue column on the left, notes on the right, summary box at the bottom.
    const cue = Math.round(width * 0.3);
    const summary = Math.round(height * 0.8);
    for (let y = m.ruledTop; y < summary; y += m.ruledSpacing) out.push([0, y, width, y]);
    out.push([cue, m.ruledTop - m.ruledSpacing, cue, summary, true]);
    out.push([0, summary, width, summary, true]);
    out.push([0, m.ruledTop - m.ruledSpacing, width, m.ruledTop - m.ruledSpacing, true]);
    return out;
  }
  if (template === 'music') {
    const gap = 9;
    const staff = gap * 4;
    const between = 58;
    for (let top = 80; top + staff < height - 40; top += staff + between) {
      for (let i = 0; i < 5; i++) out.push([56, top + i * gap, width - 56, top + i * gap]);
    }
    return out;
  }
  if (template === 'isometric') {
    // Equilateral triangles of side 28: vertical lines plus lines at ±30°.
    const side = 28;
    const t = Math.tan(Math.PI / 6);
    for (let x = 0; x <= width; x += side * Math.cos(Math.PI / 6)) out.push([x, 0, x, height]);
    for (let c = -width * t; c <= height + width * t; c += side) {
      out.push([0, c, width, c + width * t]);
      out.push([0, c, width, c - width * t]);
    }
    return out;
  }
  return null;
}

/** An SVG image of a line template, for the screen background (sharp at any zoom). */
function templateSvg(lines: TemplateLine[], width: number, height: number, color: string, strong: string): string {
  const body = lines
    .map(([x1, y1, x2, y2, s]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${s ? strong : color}" stroke-width="${s ? 1.2 : 0.8}"/>`)
    .join('');
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${body}</svg>`)}")`;
}

/** Spacing, in page units, shared by on-screen backgrounds and PDF export. */
export const TEMPLATE_METRICS = {
  ruledSpacing: 32,
  ruledTop: 96,
  ruledMargin: 80,
  gridSpacing: 24,
  dotSpacing: 24,
  lineColor: '#a9c4df',
  marginColor: '#e8a0a0',
};

/** Night-mode paper: near-black page, dim lines (used on screen, in thumbnails and dark exports). */
export const DARK_PAPER = { paper: '#1c1d21', line: '#323a46', margin: '#5e3434', dot: '#475263' };

/** Paper drawn with CSS gradients: stays sharp at any zoom and costs no canvas memory. */
export function templateStyle(template: PaperTemplate, scale: number, dark = false, size?: { width: number; height: number }): CSSProperties {
  const m = TEMPLATE_METRICS;
  const paper = dark ? DARK_PAPER.paper : '#fff';
  const lineColor = dark ? DARK_PAPER.line : m.lineColor;
  const marginColor = dark ? DARK_PAPER.margin : m.marginColor;
  const dotColor = dark ? DARK_PAPER.dot : '#8fa9c2';
  const line = Math.max(1, scale);
  const drawn = size ? templateLines(template, size.width, size.height) : null;
  if (drawn) {
    return { backgroundColor: paper, backgroundImage: templateSvg(drawn, size!.width, size!.height, lineColor, marginColor), backgroundSize: '100% 100%' };
  }
  switch (template) {
    default:
    case 'blank':
      return { backgroundColor: paper };
    case 'ruled': {
      const s = m.ruledSpacing * scale;
      return {
        backgroundColor: paper,
        backgroundImage: `linear-gradient(to right, transparent ${m.ruledMargin * scale - line}px, ${marginColor} ${
          m.ruledMargin * scale - line
        }px, ${marginColor} ${m.ruledMargin * scale}px, transparent ${m.ruledMargin * scale}px),
          repeating-linear-gradient(to bottom, transparent 0, transparent ${s - line}px, ${lineColor} ${s - line}px, ${
            lineColor
          } ${s}px)`,
        backgroundPosition: `0 0, 0 ${(m.ruledTop % m.ruledSpacing) * scale}px`,
        backgroundSize: `100% 100%, 100% ${s}px`,
      };
    }
    case 'grid': {
      const s = m.gridSpacing * scale;
      return {
        backgroundColor: paper,
        backgroundImage: `linear-gradient(to right, ${lineColor} ${line}px, transparent ${line}px),
          linear-gradient(to bottom, ${lineColor} ${line}px, transparent ${line}px)`,
        backgroundSize: `${s}px ${s}px`,
      };
    }
    case 'dotted': {
      const s = m.dotSpacing * scale;
      const r = Math.max(1, 1.3 * scale);
      return {
        backgroundColor: paper,
        backgroundImage: `radial-gradient(circle, ${dotColor} ${r}px, transparent ${r + 0.5}px)`,
        backgroundSize: `${s}px ${s}px`,
        backgroundPosition: `${s / 2}px ${s / 2}px`,
      };
    }
  }
}
