import type { CSSProperties } from 'react';
import type { PaperTemplate } from '../model/types';

export const TEMPLATE_LABELS: Record<PaperTemplate, string> = {
  blank: 'Blank',
  ruled: 'Ruled',
  grid: 'Grid',
  dotted: 'Dotted',
};

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
export function templateStyle(template: PaperTemplate, scale: number, dark = false): CSSProperties {
  const m = TEMPLATE_METRICS;
  const paper = dark ? DARK_PAPER.paper : '#fff';
  const lineColor = dark ? DARK_PAPER.line : m.lineColor;
  const marginColor = dark ? DARK_PAPER.margin : m.marginColor;
  const dotColor = dark ? DARK_PAPER.dot : '#8fa9c2';
  const line = Math.max(1, scale);
  switch (template) {
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
