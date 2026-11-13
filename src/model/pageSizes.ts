/**
 * Paper sizes, in page units (CSS pixels at 96 dpi: 1 mm = 3.7795 units), portrait.
 * Landscape swaps width and height.
 */
export type PageSizeId = 'a3' | 'a4' | 'a5' | 'b5' | 'letter' | 'legal' | 'tabloid' | 'square' | 'slide' | 'custom';

const MM = 96 / 25.4;
const mm = (w: number, h: number) => ({ width: Math.round(w * MM), height: Math.round(h * MM) });

export const PAGE_SIZES: Record<Exclude<PageSizeId, 'custom'>, { label: string; detail: string; width: number; height: number }> = {
  a4: { label: 'A4', detail: '210 × 297 mm', ...mm(210, 297) },
  a3: { label: 'A3', detail: '297 × 420 mm', ...mm(297, 420) },
  a5: { label: 'A5', detail: '148 × 210 mm', ...mm(148, 210) },
  b5: { label: 'B5', detail: '176 × 250 mm', ...mm(176, 250) },
  letter: { label: 'Letter', detail: '8.5 × 11 in', width: 816, height: 1056 },
  legal: { label: 'Legal', detail: '8.5 × 14 in', width: 816, height: 1344 },
  tabloid: { label: 'Tabloid', detail: '11 × 17 in', width: 1056, height: 1632 },
  square: { label: 'Square', detail: '1 : 1', width: 900, height: 900 },
  slide: { label: 'Slide', detail: '16 : 9', width: 720, height: 1280 },
};
export const PAGE_SIZE_ORDER: Exclude<PageSizeId, 'custom'>[] = ['a4', 'a3', 'a5', 'b5', 'letter', 'legal', 'tabloid', 'square', 'slide'];

export type Orientation = 'portrait' | 'landscape';

export interface PageDims {
  width: number;
  height: number;
}

/** Page size for a preset and orientation. */
export function dimsFor(id: Exclude<PageSizeId, 'custom'>, orientation: Orientation): PageDims {
  const s = PAGE_SIZES[id];
  const portrait = { width: Math.min(s.width, s.height), height: Math.max(s.width, s.height) };
  return orientation === 'portrait' ? portrait : { width: portrait.height, height: portrait.width };
}

export function orientationOf(d: PageDims): Orientation {
  return d.width > d.height ? 'landscape' : 'portrait';
}

/** Which preset a page size is (either orientation), or 'custom'. */
export function sizeIdOf(d: PageDims): PageSizeId {
  for (const id of PAGE_SIZE_ORDER) {
    const s = PAGE_SIZES[id];
    const a = Math.min(s.width, s.height);
    const b = Math.max(s.width, s.height);
    if (Math.abs(Math.min(d.width, d.height) - a) < 2 && Math.abs(Math.max(d.width, d.height) - b) < 2) return id;
  }
  return 'custom';
}

/** Readable name, e.g. "A4 landscape". */
export function describeSize(d: PageDims): string {
  const id = sizeIdOf(d);
  const name = id === 'custom' ? `${Math.round(d.width / MM)} × ${Math.round(d.height / MM)} mm` : PAGE_SIZES[id].label;
  return `${name} ${orientationOf(d)}`;
}

/** Custom sizes in millimetres, kept within sensible limits. */
export function customDims(widthMm: number, heightMm: number): PageDims {
  const clamp = (v: number) => Math.min(1200, Math.max(50, Number.isFinite(v) ? v : 210));
  return mm(clamp(widthMm), clamp(heightMm));
}

export const MM_PER_UNIT = 1 / MM;
