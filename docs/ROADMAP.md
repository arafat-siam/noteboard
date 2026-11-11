# Noteboard Roadmap (PWA)

## Done
- [x] Vite + React + TypeScript PWA, offline service worker, installable on iPad; CI deploy to GitHub Pages
- [x] Precise ink: coalesced + predicted Pencil events, pressure, palm rejection, Pencil hover cursor
- [x] Pens (fountain, ballpoint, pencil, brush), highlighter, custom pen tray, colours, sizes
- [x] Eraser: whole stroke or partial (pixel)
- [x] Lasso + finger-tap select; move, resize, rotate, recolour, fill with opacity, duplicate, delete
- [x] Hold-to-snap shapes with Drawboard-style adjusting; line snapping (ends, midpoints, perpendicular, parallel, angles)
- [x] Apple Pencil Pro haptics, double-tap and squeeze (Noteboard Shell app)
- [x] Laser pointer
- [x] Pictures: insert, drag & drop, paste; layering (front / forward / backward / back)
- [x] Copy / cut / paste ink and pictures across notebooks; long-press paste
- [x] Page manager: thumbnails, copy / cut / paste pages across notebooks, duplicate, delete, drag to reorder
- [x] Undo/redo (buttons, ⌘Z, two/three-finger tap), pinch zoom
- [x] Folders (nested), drag & drop, move dialog, bulk select, favorites, recents, tags, search by name/tag, trash (30 days)
- [x] PDF import, annotate, add more PDFs to a notebook, vector PDF export with the original pages embedded
- [x] Export PNG, JSON backup & import
- [x] Google Drive sync (conflict-free merge, compact storage, pause / sync now, keep on this iPad only)
- [x] PIN app lock

## Missing compared with pro note apps (GoodNotes, Notability, Drawboard, Noteshelf)
Rough priority order (★ = biggest gap).

### Writing and editing
- [ ] ★ Text boxes (typed text with fonts, sizes, colours)
- [ ] ★ Handwriting search and convert handwriting to text
- [ ] ★ Custom colours (colour wheel / hex / eyedropper) and saved favourite colours
- [ ] Ruler (and protractor) for straight lines at any angle
- [ ] Shapes tool: arrows, dashed/dotted lines, stars; line style and arrowheads on any line
- [ ] Eraser options: erase only highlighter, auto-switch back to the pen
- [ ] Rectangle selection and select-by-type in the lasso
- [ ] Zoom window (write large, ink lands small) for neat handwriting
- [ ] Picture tools: crop, opacity, replace; camera photo and document scanner
- [ ] Stickers / saved elements library (reuse drawings and pictures)
- [ ] Tape (hide answers, tap to reveal) for studying
- [ ] Audio recording synced to what you wrote

### Pages, paper and PDFs
- [ ] ★ More paper: Cornell, planner, music, isometric, custom templates; paper colour; page sizes (Letter, square) and landscape
- [ ] Change paper for all pages; rotate a page
- [ ] Bookmarks, outline / table of contents
- [ ] Links: tap a PDF link, link to another page or notebook, web links
- [ ] ★ PDF text: search, select and copy, text-aware highlighter
- [ ] Horizontal page scrolling (one page at a time) as an option
- [ ] Infinite canvas / whiteboard pages

### Library
- [ ] Notebook covers (choose / custom), folder icons
- [ ] Manual sort order (drag notebooks into your own order)
- [ ] Smart folders (saved searches), search inside notes (handwriting, typed text, PDF text)
- [ ] Notebook templates (start a notebook with chosen pages)
- [ ] Lock individual notebooks

### Sharing and sync
- [ ] Export selected pages only; print
- [ ] Share a read-only link; real-time collaboration
- [ ] Faster, near-instant sync between devices (Drive changes API)
- [ ] Version history / restore an older version of a page; automatic backups
- [ ] Presentation mode (mirror to an external display without the toolbars)

### Smart features
- [ ] Spell check and math conversion for handwriting
- [ ] Summaries / Q&A over notes (AI), audio transcription

### Polish
- [ ] Two notebooks side by side inside the app
- [ ] Dark paper mode
- [ ] Accessibility audit, localization, onboarding tour
