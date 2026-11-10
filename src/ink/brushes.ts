/** Pen types. Each is a different response to Pencil pressure and a different look. */
export type BrushKind = 'fountain' | 'ballpoint' | 'pencil' | 'brush';

export interface BrushStyle {
  label: string;
  /** How much pressure changes the width (0 = uniform line). */
  thinning: number;
  /** Tapered ends, in page units (0 = round ends). */
  taper: number;
  /** Fill opacity. */
  opacity: number;
  /** Grainy graphite texture. */
  textured: boolean;
}

export const BRUSHES: Record<BrushKind, BrushStyle> = {
  fountain: { label: 'Fountain pen', thinning: 0.6, taper: 0, opacity: 1, textured: false },
  ballpoint: { label: 'Ballpoint', thinning: 0.12, taper: 0, opacity: 1, textured: false },
  pencil: { label: 'Pencil', thinning: 0.3, taper: 0, opacity: 0.85, textured: true },
  brush: { label: 'Brush', thinning: 0.85, taper: 18, opacity: 0.95, textured: false },
};

export const BRUSH_ORDER: BrushKind[] = ['fountain', 'ballpoint', 'pencil', 'brush'];
