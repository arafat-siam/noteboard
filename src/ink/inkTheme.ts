/**
 * Night mode for pages (like GoodNotes / Notability "dark paper"): the paper turns dark and ink
 * colours are shown with their lightness flipped, so black writing reads as white, dark blue as
 * light blue, while mid colours (red, green, orange…) keep their look. Only the display changes:
 * strokes keep the colour they were written with, so light mode, other devices and normal exports
 * are unaffected.
 */

let dark = false;

/** Whether pages are currently drawn in night mode. */
export function inkIsDark(): boolean {
  return dark;
}

/** Switches night mode for drawing; returns the previous value (to restore after an export). */
export function setInkDark(value: boolean): boolean {
  const previous = dark;
  dark = value;
  return previous;
}

function hexToHsl(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = Number.parseInt(m[1]!, 16);
  const r = ((v >> 16) & 255) / 255;
  const g = ((v >> 8) & 255) / 255;
  const b = (v & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const cache = new Map<string, string>();

/** The colour as shown on dark paper (pure, cached). */
export function darkVariant(color: string): string {
  let out = cache.get(color);
  if (out) return out;
  const hsl = hexToHsl(color);
  if (!hsl) out = color;
  else {
    const [h, s, l] = hsl;
    // Dark colours become light (black → white); near-white becomes near-black; the rest stays.
    const nl = l < 0.5 ? 1 - l * 0.85 : l > 0.9 ? 1 - l + 0.08 : l;
    out = hslToHex(h, s, nl);
  }
  cache.set(color, out);
  return out;
}

/** Ink colour as it should be drawn right now. */
export function displayColor(color: string): string {
  return dark ? darkVariant(color) : color;
}
