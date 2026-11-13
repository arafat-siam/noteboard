/** Colours and sizes offered in the tool palette, selection menu and quick palette. */
import type { DashStyle, PenStyle, TextFont } from '../model/types';
import type { BrushKind } from './brushes';
import type { ShapeToolKind } from './shapeTool';

export const PEN_COLORS = ['#1c1c1e', '#2f6fde', '#d93025', '#1e8e3e', '#f29900', '#9334e6', '#12a4af', '#8d6e63', '#ffffff'];
export const HIGHLIGHTER_COLORS = ['#ffe14d', '#7cf29c', '#7cd4ff', '#ff9ad5', '#ffb86b', '#c9a7ff'];
export const TAPE_COLORS = ['#f4b400', '#5b8def', '#34a853', '#ea4335', '#a142f4', '#607d8b', '#1c1c1e', '#ff8fb1'];
export const PEN_SIZE_RANGE = { min: 0.5, max: 16, step: 0.1 };
export const HIGHLIGHTER_SIZE_RANGE = { min: 6, max: 48, step: 1 };
export const ERASER_SIZE_RANGE = { min: 4, max: 80, step: 1 };
export const SHAPE_SIZE_RANGE = { min: 0.5, max: 12, step: 0.1 };
export const TAPE_SIZE_RANGE = { min: 10, max: 80, step: 1 };

/** One pen in the user's tray. Several can share a type with different colours or sizes. */
export interface PenSlot {
  id: string;
  kind: 'pen' | 'highlighter';
  brush: BrushKind;
  color: string;
  size: number;
  /** Fine-tuning of this pen (opacity, pressure, taper, smoothing). Missing = pen type default. */
  penStyle?: PenStyle;
}

export const DEFAULT_SLOTS: PenSlot[] = [
  { id: 'slot-fountain', kind: 'pen', brush: 'fountain', color: '#1c1c1e', size: 2.5 },
  { id: 'slot-ballpoint', kind: 'pen', brush: 'ballpoint', color: '#2f6fde', size: 2 },
  { id: 'slot-pencil', kind: 'pen', brush: 'pencil', color: '#3a3a3c', size: 2.5 },
  { id: 'slot-brush', kind: 'pen', brush: 'brush', color: '#d93025', size: 5 },
  { id: 'slot-highlighter', kind: 'highlighter', brush: 'fountain', color: '#ffe14d', size: 20 },
];

export const MAX_SLOTS = 12;

export interface TextToolSettings {
  font: TextFont;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
  background: string | null;
}

export interface ShapeToolSettings {
  kind: ShapeToolKind;
  color: string;
  size: number;
  dash: DashStyle | null;
  fill: string | null;
  fillOpacity: number;
}

export interface TapeToolSettings {
  color: string;
  width: number;
}

export interface PointerSettings {
  /** Hover cursor for pens. */
  cursor: 'dot' | 'ring' | 'crosshair';
  laserColor: string;
  /** Laser dot size, CSS px. */
  laserSize: number;
  /** How long the laser trail stays (ms); 0 = dot only, no trail. */
  laserTrail: number;
}

export const DEFAULT_TEXT: TextToolSettings = {
  font: 'sans',
  size: 18,
  color: '#1c1c1e',
  bold: false,
  italic: false,
  underline: false,
  align: 'left',
  background: null,
};
export const DEFAULT_SHAPE: ShapeToolSettings = { kind: 'rectangle', color: '#1c1c1e', size: 2, dash: null, fill: null, fillOpacity: 0.25 };
export const DEFAULT_TAPE: TapeToolSettings = { color: '#f4b400', width: 28 };
export const DEFAULT_POINTER: PointerSettings = { cursor: 'dot', laserColor: '#ff3b30', laserSize: 10, laserTrail: 900 };
export const LASER_COLORS = ['#ff3b30', '#34c759', '#0a84ff', '#ff9f0a', '#bf5af2', '#ffffff'];
