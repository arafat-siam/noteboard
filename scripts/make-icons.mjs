// Generates every app icon from one vector design (the Noteboard logo).
// Run: npm run icons
//
// Design (minimal): a charcoal tile, one white page with a folded corner, and a single
// handwritten stroke.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const CHARCOAL = '#1C252E';

/** The logo on a 1024 × 1024 canvas. `rounded`: corner radius of the tile (0 = full bleed). */
function logo(rounded) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <rect width="1024" height="1024" rx="${rounded}" fill="${CHARCOAL}"/>
  <path d="M308 216 H608 L716 324 V748 Q716 808 656 808 H308 Q248 808 248 748 V276 Q248 216 308 216 Z" fill="#FFFFFF"/>
  <path d="M608 216 V284 Q608 324 648 324 H716 Z" fill="#C4CDD5"/>
  <path d="M342 628 C 366 548, 404 500, 420 528 C 436 556, 402 628, 424 628 C 452 628, 476 528, 524 528 C 568 528, 546 628, 594 628 C 622 628, 642 604, 660 576"
        fill="none" stroke="${CHARCOAL}" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

function render(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

mkdirSync('public', { recursive: true });
// Home Screen / install icons are full squares: iPadOS and Android round the corners themselves.
const square = logo(0);
writeFileSync('public/icon-512.png', render(square, 512));
writeFileSync('public/icon-192.png', render(square, 192));
writeFileSync('public/apple-touch-icon.png', render(square, 180));
// Browser tab icon keeps its own rounded corners.
writeFileSync('public/icon.svg', logo(228));
// Noteboard Shell (Swift Playgrounds) app icon.
const assets = 'wrapper/NoteboardShell.swiftpm/Sources/Assets.xcassets';
mkdirSync(`${assets}/AppIcon.appiconset`, { recursive: true });
writeFileSync(`${assets}/AppIcon.appiconset/AppIcon.png`, render(square, 1024));
writeFileSync(
  `${assets}/AppIcon.appiconset/Contents.json`,
  JSON.stringify(
    { images: [{ filename: 'AppIcon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }], info: { author: 'xcode', version: 1 } },
    null,
    2,
  ) + '\n',
);
writeFileSync(`${assets}/Contents.json`, JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
// Optional preview with rounded corners, for checking the design: ICON_PREVIEW=path npm run icons
if (process.env.ICON_PREVIEW) writeFileSync(process.env.ICON_PREVIEW, render(logo(228), 512));
console.log('Icons written.');
