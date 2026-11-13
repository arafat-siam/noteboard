# Changing the Noteboard logo

The logo is drawn once, as code, in `scripts/make-icons.mjs` (the `logo()` function). One command
turns it into every icon the app needs:

| File | Used for |
|---|---|
| `public/icon.svg` | Browser tab icon and the launch screen logo |
| `public/apple-touch-icon.png` | Icon on the iPad Home Screen |
| `public/icon-192.png`, `public/icon-512.png` | App icon in the install manifest |
| `wrapper/.../AppIcon.png` | The optional native shell app |

## Easiest way

Ask Claude: "change the logo to …" (describe it, or attach a picture). Claude edits `logo()` in
`scripts/make-icons.mjs` and runs `npm run icons`.

## Doing it yourself

1. Open `scripts/make-icons.mjs` and replace the SVG inside the `logo()` function with your design
   (keep the 1024 × 1024 canvas). Any vector editor (Figma, Inkscape, Illustrator) can export SVG.
2. In a terminal in the project folder run `npm run icons`.
3. Commit and push. GitHub Actions publishes the site in a few minutes.

## On the iPad

Safari remembers Home Screen icons. To see the new one: press and hold the Noteboard icon →
**Remove App** → **Remove from Home Screen** (your notes are kept in Safari's storage and in Google
Drive), then open the site in Safari → Share → **Add to Home Screen** again. The launch screen
inside the app updates by itself.
