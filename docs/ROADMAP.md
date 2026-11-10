# Noteboard Roadmap

Each milestone should be shippable to TestFlight.

## M0 — Foundation (current)
- [x] Project structure, XcodeGen, NoteboardKit modules, subagents
- [x] Core models + `.noteboard` manifest format v1
- [ ] CI on macOS runner (build + `swift test`)
- [ ] Logging, error reporting, app settings scaffold

## M1 — Library & organization (differentiator)
- [ ] Nested folders on disk, SwiftData index, rebuild-from-disk
- [ ] Three-column `NavigationSplitView`: sidebar (Library, Favorites, Recents, Tags, Smart Folders, Trash) / folder contents / preview
- [ ] Grid & list views, sort options, folder colors/icons
- [ ] Create/rename/move/duplicate/delete, multi-select bulk actions, drag & drop
- [ ] Tags, favorites, recents, trash with restore + 30-day purge
- [ ] Smart folders (saved queries)
- [ ] Files app visibility, import from Files

## M2 — Notebook editor & ink
- [ ] Notebook with paper templates (blank, ruled, grid, dotted, Cornell, planner), page sizes, covers
- [ ] PencilKit canvas with page virtualization, vertical & horizontal scroll, zoom
- [ ] Pens (fountain, ball, brush), highlighter, erasers (stroke/pixel/partial), lasso (move/resize/recolor)
- [ ] Favorite tools bar, color presets, Pencil double-tap/squeeze
- [ ] Page manager: thumbnails, add/reorder/duplicate/delete pages
- [ ] Undo/redo, auto-save

## M3 — PDF (Drawboard parity)
- [ ] Import PDF as notebook or into existing notebook
- [ ] Annotate over PDF, insert blank pages between PDF pages
- [ ] PDF text search, outline/bookmarks, links
- [ ] Export: flattened PDF, PDF with annotations, images, `.noteboard`

## M4 — Pro features (GoodNotes parity)
- [ ] Shape recognition, ruler, laser pointer, tape tool
- [ ] Text boxes, images, stickers/elements library
- [ ] Handwriting search (Vision) + convert handwriting to text
- [ ] Global search across library (titles, text, PDF text, handwriting), Spotlight
- [ ] Hyperlinks between pages/notebooks, document outline
- [ ] Presentation mode (external display), multi-window side-by-side
- [ ] Audio recording synced to ink
- [ ] Templates & covers marketplace (local packs)

## M5 — Sync & reliability
- [ ] iCloud Drive sync, conflict resolution UI
- [ ] Automatic backups, export entire library
- [ ] Password/Face ID lock for folders

## M6 — Launch
- [ ] Onboarding, paywall (StoreKit 2), analytics (privacy-preserving)
- [ ] Localization, accessibility audit, performance audit
- [ ] App Store assets
