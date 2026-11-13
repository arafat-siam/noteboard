import { describe, expect, it } from 'vitest';
import { darkVariant, displayColor, setInkDark } from './inkTheme';

describe('night mode ink colours', () => {
  it('turns black writing white and white writing dark', () => {
    expect(darkVariant('#000000')).toBe('#ffffff');
    expect(darkVariant('#1c1c1e')).toMatch(/^#e[0-9a-f]{5}$/);
    expect(darkVariant('#ffffff')).toMatch(/^#1[0-9a-f]{5}$/);
  });
  it('keeps mid colours and the hue of dark colours', () => {
    expect(darkVariant('#7cd4ff')).toBe('#7cd4ff'); // light colours are already readable on dark paper
    const red = Number.parseInt(darkVariant('#d93025').slice(1), 16); // red stays red
    expect((red >> 16) & 255).toBeGreaterThan(200);
    expect((red >> 8) & 255).toBeLessThan(120);
    const navy = darkVariant('#1a237e'); // dark blue becomes a light blue
    const v = Number.parseInt(navy.slice(1), 16);
    expect(v & 255).toBeGreaterThan((v >> 16) & 255);
    expect(v & 255).toBeGreaterThan(180);
  });
  it('only changes the display while night mode is on', () => {
    setInkDark(false);
    expect(displayColor('#000000')).toBe('#000000');
    setInkDark(true);
    expect(displayColor('#000000')).toBe('#ffffff');
    setInkDark(false);
  });
});
