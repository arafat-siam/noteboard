# Noteboard Roadmap (PWA)

## M0 — Foundation ✅
- [x] Vite + React + TypeScript PWA, offline service worker, installable on iPad
- [x] CI: type check, tests, build, deploy to GitHub Pages
- [x] Data model, IndexedDB, unit tests

## M1 — Core (current)
- [x] Precise ink: coalesced + predicted Pencil events, pressure, palm rejection
- [x] Pen, highlighter, stroke eraser, lasso (move/duplicate/delete), colors, sizes
- [x] Hold-to-snap shape recognition
- [x] Undo/redo (buttons, ⌘Z, two/three-finger tap), pinch zoom
- [x] Folders (nested), drag & drop, move dialog, bulk select, favorites, recents, tags, search, trash (30 days)
- [x] Google Drive sync (library.json + per-page files, conflict-free merge)
- [x] Export PDF / PNG, JSON backup & import
- [ ] Verify on a real iPad: Pencil feel, scrolling, sign-in, sync between two devices

## M2 — Pro tools
- [ ] Partial (pixel) eraser, eraser that only erases highlighter
- [ ] Text boxes, images, stickers
- [ ] Shapes: arrows, resize/rotate selection, ruler
- [ ] Laser pointer / presentation mode
- [ ] Page thumbnails sidebar, reorder pages by drag, templates: Cornell, planner, music
- [ ] Notebook covers, folder icons, custom sort order (manual)

## M3 — PDF
- [ ] Import PDF (pdf.js render) as notebook, annotate on top, export with annotations
- [ ] PDF text search, outline, links

## M4 — Smart features
- [ ] Handwriting search / convert to text (on-device model or optional cloud OCR)
- [ ] Smart folders (saved searches)
- [ ] Hyperlinks between pages/notebooks

## M5 — Reliability & polish
- [ ] Lazy page download for huge libraries, Drive changes API
- [ ] Sync conflict log, automatic backups to Drive
- [ ] Optional native wrapper for Pencil double-tap/squeeze (personal use via Swift Playgrounds)
- [ ] Accessibility audit, localization, onboarding
