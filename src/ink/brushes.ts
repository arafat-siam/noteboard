import type { BrushKind, PenStyle, Stroke } from '../model/types';

export type { BrushKind };

export interface BrushStyle {
  label: string;
  /** One-line description shown in the pen settings. */
  hint: string;
  /** How much pressure changes the width (0 = uniform line). */
  thinning: number;
  /** Tapered ends, in page units (0 = round ends). */
  taper: number;
  /** Fill opacity. */
  opacity: number;
  /** Grain texture: 0 = solid ink, 1 = fine graphite, 2 = coarse wax. */
  grain: 0 | 1 | 2;
  /** Flat nib at a fixed angle: thick and thin strokes depend on direction. */
  calligraphy?: boolean;
  /** Default smoothing (0–1). */
  stabilize: number;
}

export const BRUSHES: Record<BrushKind, BrushStyle> = {
  fountain: { label: 'Fountain pen', hint: 'Responds to pressure', thinning: 0.6, taper: 0, opacity: 1, grain: 0, stabilize: 0 },
  ballpoint: { label: 'Ballpoint', hint: 'Even line, light pressure response', thinning: 0.12, taper: 0, opacity: 1, grain: 0, stabilize: 0 },
  fineliner: { label: 'Fineliner', hint: 'Perfectly even line', thinning: 0, taper: 0, opacity: 1, grain: 0, stabilize: 0.2 },
  pencil: { label: 'Pencil', hint: 'Grainy graphite', thinning: 0.3, taper: 0, opacity: 0.85, grain: 1, stabilize: 0 },
  brush: { label: 'Brush pen', hint: 'Tapered, very pressure sensitive', thinning: 0.85, taper: 18, opacity: 0.95, grain: 0, stabilize: 0.15 },
  marker: { label: 'Marker', hint: 'Bold, slightly see-through', thinning: 0, taper: 0, opacity: 0.88, grain: 0, stabilize: 0.25 },
  calligraphy: { label: 'Calligraphy', hint: 'Flat nib: thick and thin strokes', thinning: 0.2, taper: 0, opacity: 1, grain: 0, stabilize: 0.2 },
  crayon: { label: 'Crayon', hint: 'Coarse wax texture', thinning: 0.25, taper: 0, opacity: 0.9, grain: 2, stabilize: 0 },
};

export const BRUSH_ORDER: BrushKind[] = ['fountain', 'ballpoint', 'fineliner', 'pencil', 'brush', 'marker', 'calligraphy', 'crayon'];

export function isBrushKind(value: unknown): value is BrushKind {
  return typeof value === 'string' && value in BRUSHES;
}

/** The pen type's look with the stroke's own overrides applied. */
export function resolveBrush(stroke: Pick<Stroke, 'brush' | 'penStyle'>): BrushStyle {
  // Unknown pen types (from a newer version on another device) draw as a fountain pen.
  const base = BRUSHES[isBrushKind(stroke.brush) ? stroke.brush : 'fountain'];
  const o: PenStyle | undefined = stroke.penStyle;
  if (!o) return base;
  return {
    ...base,
    opacity: o.opacity ?? base.opacity,
    thinning: o.thinning ?? base.thinning,
    taper: o.taper ?? base.taper,
    stabilize: o.stabilize ?? base.stabilize,
  };
}
