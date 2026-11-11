// Generates every app icon from one vector design (the Noteboard logo).
// Run: npm run icons
//
// Design: a white note page with a folded corner on a blue → violet tile, a flowing ink
// stroke across it, and a pencil finishing the stroke.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

/** The logo on a 1024 × 1024 canvas. `rounded`: corner radius of the tile (0 = full bleed). */
function logo(rounded) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4C7DFF"/>
      <stop offset="0.55" stop-color="#5B5BF5"/>
      <stop offset="1" stop-color="#7A3FE8"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.22" cy="0.12" r="0.75">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.30"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ink" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#3F6CFF"/>
      <stop offset="1" stop-color="#7B3FE4"/>
    </linearGradient>
    <linearGradient id="fold" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#C9D3F7"/>
      <stop offset="1" stop-color="#EEF2FF"/>
    </linearGradient>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFC94A"/>
      <stop offset="0.5" stop-color="#FFB21E"/>
      <stop offset="1" stop-color="#F29A0E"/>
    </linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="22"/>
    </filter>
  </defs>

  <rect width="1024" height="1024" rx="${rounded}" fill="url(#bg)"/>
  <rect width="1024" height="1024" rx="${rounded}" fill="url(#glow)"/>

  <g transform="rotate(-7 480 500)">
    <!-- page shadow -->
    <path d="M300 214 H592 L692 314 V744 Q692 796 640 796 H300 Q248 796 248 744 V266 Q248 214 300 214 Z"
          fill="#1B1460" opacity="0.32" filter="url(#shadow)" transform="translate(10 26)"/>
    <!-- page with folded corner -->
    <path d="M300 214 H592 L692 314 V744 Q692 796 640 796 H300 Q248 796 248 744 V266 Q248 214 300 214 Z" fill="#FFFFFF"/>
    <path d="M592 214 V282 Q592 314 624 314 H692 Z" fill="url(#fold)"/>
    <!-- ruled lines -->
    <g stroke="#E4E9F7" stroke-width="12" stroke-linecap="round">
      <line x1="314" y1="372" x2="540" y2="372"/>
      <line x1="314" y1="444" x2="626" y2="444"/>
      <line x1="314" y1="516" x2="626" y2="516"/>
    </g>
    <!-- handwriting stroke -->
    <path d="M318 662 C 352 560, 404 548, 418 616 C 430 676, 476 690, 506 628 C 532 574, 574 556, 600 604"
          fill="none" stroke="url(#ink)" stroke-width="36" stroke-linecap="round" stroke-linejoin="round"/>

    <!-- pencil: tip at the end of the stroke, body towards the lower right -->
    <g transform="translate(604 612) rotate(48)">
      <rect x="40" y="12" width="300" height="58" rx="10" fill="#1B1460" opacity="0.28" filter="url(#shadow)"/>
      <path d="M0 0 L66 -29 L66 29 Z" fill="#F6D7AE"/>
      <path d="M0 0 L22 -9.6 L22 9.6 Z" fill="#2A2A35"/>
      <rect x="64" y="-29" width="200" height="58" fill="url(#body)"/>
      <rect x="64" y="-29" width="200" height="16" fill="#FFFFFF" opacity="0.28"/>
      <rect x="262" y="-29" width="30" height="58" fill="#C7CEDF"/>
      <rect x="270" y="-29" width="5" height="58" fill="#A8B1C7"/>
      <rect x="282" y="-29" width="5" height="58" fill="#A8B1C7"/>
      <path d="M290 -29 H318 Q338 -29 338 -9 V9 Q338 29 318 29 H290 Z" fill="#FF6F91"/>
    </g>
  </g>
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
