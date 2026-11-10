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

/** Paper drawn with CSS gradients: stays sharp at any zoom and costs no canvas memory. */
export function templateStyle(template: PaperTemplate, scale: number): CSSProperties {
  const m = TEMPLATE_METRICS;
  const line = Math.max(1, scale);
  switch (template) {
    case 'blank':
      return { backgroundColor: '#fff' };
    case 'ruled': {
      const s = m.ruledSpacing * scale;
      return {
        backgroundColor: '#fff',
        backgroundImage: `linear-gradient(to right, transparent ${m.ruledMargin * scale - line}px, ${m.marginColor} ${
          m.ruledMargin * scale - line
        }px, ${m.marginColor} ${m.ruledMargin * scale}px, transparent ${m.ruledMargin * scale}px),
          repeating-linear-gradient(to bottom, transparent 0, transparent ${s - line}px, ${m.lineColor} ${s - line}px, ${
            m.lineColor
          } ${s}px)`,
        backgroundPosition: `0 0, 0 ${(m.ruledTop % m.ruledSpacing) * scale}px`,
        backgroundSize: `100% 100%, 100% ${s}px`,
      };
    }
    case 'grid': {
      const s = m.gridSpacing * scale;
      return {
        backgroundColor: '#fff',
        backgroundImage: `linear-gradient(to right, ${m.lineColor} ${line}px, transparent ${line}px),
          linear-gradient(to bottom, ${m.lineColor} ${line}px, transparent ${line}px)`,
        backgroundSize: `${s}px ${s}px`,
      };
    }
    case 'dotted': {
      const s = m.dotSpacing * scale;
      const r = Math.max(1, 1.3 * scale);
      return {
        backgroundColor: '#fff',
        backgroundImage: `radial-gradient(circle, #8fa9c2 ${r}px, transparent ${r + 0.5}px)`,
        backgroundSize: `${s}px ${s}px`,
        backgroundPosition: `${s / 2}px ${s / 2}px`,
      };
    }
  }
}
