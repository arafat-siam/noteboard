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
- [x] Text boxes (fonts, size, bold/italic/underline, alignment, colour, highlight), editable, move/resize/rotate
- [x] Shapes tool: 13 shapes, solid / dashed / dotted borders, arrows, fill; line style + arrowheads on any selected ink
- [x] Tape (any colour, tap to peek), eight pen types (fineliner, marker, calligraphy, crayon added) with opacity / pressure / taper / smoothing per pen
- [x] Hex colours and colour wheel everywhere; laser colour / size / trail; hover pointer dot / ring / crosshair
- [x] Toolbar floating or docked, on any side; Light / Dark / Automatic appearance; launch screen with logo
- [x] Export chosen pages (range or picked in Pages) as PDF or PNG images
- [x] Drive changes feed: idle devices check with one small request; pages transfer 4 at a time
- [x] Night mode pages (ink colours flip automatically), page sizes A3–A5/Letter/… portrait or landscape
- [x] Optional app passcode, per-notebook passcode locks (kept when shared)
- [x] Selection: lock items, rectangle lasso, filters, groups, align/distribute/flip, smart guides
- [x] Ruler and protractor; links (PDF, pages, notebooks, web); view-only share links; audio recording with synced playback
- [x] Neutral, minimal design (restore point of the earlier look: git tag ui-v1)
- [x] Drawboard-style library: + menu, account panel with sync badge and Drive storage, formal wording, menus with icons
- [x] Saved toolbar presets (synced), tap empty space to hide bars, lock screen opens on the right passcode
- [x] Handwriting search (Google Drive text recognition) and Copy as text; search in PDFs; Find in notebook
- [x] PDF text: copy line/page, text-aware highlighter
- [x] Zoom writing window; Cornell, music and isometric paper; linked monthly planners
- [x] Bookmarks and contents, flashcards from tape, presentation mode, whiteboard pages that grow

## Missing compared with pro note apps (GoodNotes, Notability, Drawboard, Noteshelf)
Rough priority order (★ = biggest gap).

### Writing and editing
- [x] ★ Handwriting search and convert handwriting to text
- [ ] Eyedropper and saved favourite colours
- [x] Ruler (and protractor) for straight lines at any angle
- [ ] Eraser: auto-switch back to the pen
- [x] Rectangle selection and select-by-type in the lasso
- [x] Zoom window (write large, ink lands small) for neat handwriting
- [ ] Picture tools: crop, opacity, replace; camera photo and document scanner
- [ ] Stickers / saved elements library (reuse drawings and pictures)
- [x] Audio recording synced to what you wrote

### Pages, paper and PDFs
- [ ] ★ More paper: Cornell, planner, music, isometric, custom templates; paper colour; page sizes (Letter, square) and landscape
- [ ] Change paper for all pages; rotate a page
- [x] Bookmarks, outline / table of contents
- [x] Links: tap a PDF link, link to another page or notebook, web links
- [x] ★ PDF text: search, select and copy, text-aware highlighter
- [ ] Horizontal page scrolling (one page at a time) as an option
- [x] Infinite canvas / whiteboard pages

### Library
- [ ] Notebook covers (choose / custom), folder icons
- [ ] Manual sort order (drag notebooks into your own order)
- [ ] Smart folders (saved searches), search inside notes (handwriting, typed text, PDF text)
- [ ] Notebook templates (start a notebook with chosen pages)
- [x] Lock individual notebooks

### Sharing and sync
- [ ] Print
- [ ] Share a read-only link; real-time collaboration
- [ ] Push notifications for near-instant sync (Drive changes are polled every minute)
- [ ] Version history / restore an older version of a page; automatic backups
- [ ] Presentation mode (mirror to an external display without the toolbars)

### Smart features
- [ ] Spell check and math conversion for handwriting
- [ ] Summaries / Q&A over notes (AI), audio transcription

### Polish
- [ ] Two notebooks side by side inside the app
- [x] Dark paper (the app UI already has dark mode)
- [ ] Accessibility audit, localization, onboarding tour
