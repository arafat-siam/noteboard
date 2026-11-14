# Noteboard

Handwriting note-taking **PWA** for iPad + Apple Pencil (GoodNotes/Drawboard class), installed from Safari via "Add to Home Screen". No App Store, no backend: data lives in IndexedDB on the device and syncs to the user's own **Google Drive**. Differentiators: precise ink and first-class folder organization.

The owner has no iPad/web development background — Claude does all development. Explain any manual step (GitHub settings, Google Cloud console, iPad) click by click.

## Stack
- TypeScript (strict), React 18, Vite 5, `vite-plugin-pwa` (offline service worker + manifest)
- Dexie (IndexedDB) + `dexie-react-hooks` for the local database
- `perfect-freehand` (ink outlines), `pdf-lib` (PDF export, lazy-loaded)
- Vitest + `fake-indexeddb` for tests
- Hosted on GitHub Pages at https://arafat-siam.github.io/noteboard/ (deployed by CI on every push to main)
- The earlier native Swift version is archived on the `native-swift` branch — don't touch it unless asked.

## Layout
```
src/model/types.ts      Data model (Folder, Notebook, Page, Stroke) — ink in page units (A4 @ 96 dpi)
src/db/                 Dexie schema, library ops (folders/trash/move), page ops (+ tests)
src/ink/                InkPage (Pencil input + canvas), render, shapes (recognition), geometry, templates
src/sync/               Google auth (redirect token flow), Drive REST client, merge rules, SyncEngine
src/export/             PDF / PNG / JSON backup export & import, share sheet
src/pdf/pdf.ts          PDF import (pdf.js, lazy-loaded), page background rendering per visible region
src/ui/                 Sidebar, LibraryView, NotebookEditor, dialogs
src/pencil/bridge.ts    Hook for an optional native wrapper to forward Pencil double-tap/squeeze
docs/                   ARCHITECTURE.md, ROADMAP.md, GOOGLE_DRIVE_SETUP.md
```

## Commands
```bash
npm install
npm run dev        # http://localhost:5173 (also reachable from the iPad on the same Wi-Fi via the printed network URL)
npm test           # vitest
npm run typecheck
npm run build
```
Verify UI changes in the browser pane (launch config `noteboard-dev`). Synthetic pointer events work for ink tests (see how InkPage handles setPointerCapture).

## Rules
- **Never lose ink.** Strokes are immutable with ids; erasing = tombstone id; page merges are union-minus-tombstones (`src/sync/merge.ts`). Any data-model change needs a merge rule + test.
- Every library mutation goes through `src/db/library.ts` / `pages.ts` (they bump `libraryRev` / page `dirty` for sync), then call `sync.syncSoon()` (UI uses `act()`).
- Never run side effects inside React state updater functions (StrictMode runs them twice — this already caused a double-undo bug).
- iPad Safari canvas memory is tight: only pages near the viewport keep canvases (see InkPage).
- iPadOS Scribble delays Pencil touches in web pages; the editor `preventDefault`s stylus touchstart/touchmove (except on buttons/inputs) to opt out. Don't remove it.
- Pencil hover (`pointermove` with `buttons === 0`) drives the hover cursor and hover-hold quick palette; hovering must never count as pen contact for palm rejection.
- Hover cursor (`src/ink/hoverCursor.ts` + `hoverTracker.ts`, tested): one element, moved once per frame from filtered samples (never straight from the event handler), only `transform` per frame, and a one-frame CSS glide so the 120 Hz screen gets in-between positions (Safari draws pages at ~60 fps; without it the dot looks doubled). `GLIDE = false` turns the glide off.
- Page canvases keep one size per zoom/screen and slide along the page; on scroll the drawn ink is shifted inside the canvas and only the uncovered strip is drawn (`drawPageParts`). Don't resize or fully repaint canvases while scrolling. The live canvas exists only on on-screen pages.
- Testing in the browser pane while it is hidden: `requestAnimationFrame` and `scroll` events don't fire. Replace rAF with a `setTimeout` version and dispatch `scroll` by hand in the test script.
- Selecting: a finger tap (or long-press) on ink selects it; Pencil taps draw dots. Snapped lines snap to ends/midpoints/perpendicular/parallel/15° angles of straight ink (`src/ink/snapping.ts`, + tests).
- Apple Pencil Pro haptics: `src/pencil/haptics.ts` posts to the shell's `noteboardHaptic` handler (`PencilHaptics.swift`, UICanvasFeedbackGenerator, iPadOS 17.5+). Safari/Home Screen can't vibrate the Pencil.
- Laser pointer tool: live layer only, never saved.
- Pictures are strokes with `tool: 'image'` (4 corner points + `image.fileId` in the files table, synced as file_<id>.<ext>), so select/move/rotate/undo/sync/merge work unchanged. The eraser skips them.
- Layering = stacking by `createdAt` (fractions allowed); everything is drawn in that order (`src/ink/layers.ts`). Moving keeps createdAt; duplicates/pastes go on top.
- Clipboard (`src/ink/clipboard.ts`): copied ink/pictures or pages, works across notebooks. Page manager: `src/ui/PageManager.tsx`.
- Web pages can't receive Pencil double-tap, squeeze or barrel roll; those need the native wrapper (see `src/pencil/bridge.ts`).
- Pencil must never scroll the page (touchstart with `touchType === 'stylus'` is prevented in NotebookEditor); fingers scroll.
- App lock (`src/security/`): the user sets the PIN on first launch; only a salted PBKDF2 hash is stored on the device. Never hard-code a PIN or any secret — the repo and the deployed JS are public. It's a lock screen, not disk encryption; say so honestly.
- Data privacy model: the site is public but holds no data. Each visitor's notes live in their own browser (IndexedDB) and their own Google Drive.
- Imported PDFs live in the Dexie `files` table (immutable blobs) and sync to Drive as `file_<id>.pdf`; pages reference them via `page.background`. Export embeds the original PDF pages (pdf-lib embedPdf) under the ink.
- Local layout: each stroke is its own row in the Dexie `strokes` table (v3); `pages` rows hold no ink. Read/write whole pages with `loadPage` / `writePage` / `applyStrokeChange` in `src/db/pages.ts` (never `db.pages` for ink). Open pages apply own edits in memory via `onLocalEdit` and re-read only on outside changes (sync) — re-reading full pages after every line caused the hover-ghost freeze. Drive files still hold whole pages.
- Storage: ink is stored at 0.01 page units / 0.001 pressure (`src/sync/compact.ts`, applied in `applyStrokeChange` and before upload); Drive data files are gzip JSON, and `readJson` still reads old plain-JSON files.
- "Keep on this iPad only" (`src/sync/localOnly.ts`) is per device (meta `localOnlyIds`, covers folder contents): never pushed, excluded from library.json, existing Drive copies trashed via a removal queue. `src/sync/engine.test.ts` runs the real engine against a fake Drive with two devices — extend it for sync changes.
- Google scope is `drive.file` only. No secrets in the repo (the OAuth client ID is public by design).
- Text boxes are strokes with `tool: 'text'` (4 corners like pictures + `text` content/format, laid out in `src/ink/text.ts` and mapped onto the corners), so move/resize/rotate/undo/sync work unchanged. Editing replaces the stroke (new id). The editor's textarea is always in the DOM and focused synchronously in the pointer handler, otherwise iPad Safari won't open the keyboard. The eraser skips text and pictures.
- Shapes tool (`src/ink/shapeTool.ts`) makes plain pen strokes (dense outline points, `brush: 'fineliner'`). `dash` ('dashed' | 'dotted') and `arrowStart/arrowEnd` are drawn from the centre line as filled M/L/Z paths, shared by screen and PDF export.
- Tape = `tool: 'tape'` band along its points; tapping (tape tool or finger) peeks under it via `revealedTape` in render.ts (session only, never saved).
- Toolbar presets (`src/ink/presets.ts`): named sets of pen slots in meta `toolPresets`, synced inside library.json (`presets` field; merge = per-preset last-writer-wins, sticky `deletedIds`, newest default wins; tested in engine.test.ts). The tray's `settings.slots` are the active preset's slots (session-scoped active id; a new session starts with the default).
- Pens: 8 types in `src/ink/brushes.ts`; per-pen `penStyle` (opacity, thinning, taper, stabilize) is saved on each stroke so it looks the same everywhere. Unknown brush names draw as fountain pen.
- Toolbar layout (`usePaletteLayout` in ToolPalette): floating or docked, top/bottom/left/right. Docked bars sit in `.editor-body`'s flex layout; floating ones are fixed.
- Optional "Tap empty space to hide bars" (`layout.tapHidesBars`, `src/ui/useBarsAutoHide.ts`): a single-finger tap on empty space hides the top bar (kept mounted, `display: none` after a slide) and shrinks the tools to the pen button. Pages call `noteTapHandled()` (`src/ink/tapSignal.ts`) when a tap selected ink / followed a link / peeked tape, so it doesn't also toggle.
- Theme: `src/ui/theme.ts` sets `data-theme` on <html> (index.html applies it before load). All colours are CSS tokens (design.css): neutral charcoal accent (white in dark mode); status green is `--ok`. `src/shell.css` (loaded last) holds the sidebar, account panel, menus and library header. Pages stay white. No emoji in the UI: use `src/ui/Icon.tsx`.
- Menus: use `MenuButton` / `MenuItem` (`src/ui/Menu.tsx`) — every row has an icon. UI wording is formal (no contractions, full sentences in hints and confirmations), "passcode" not "PIN".
- Account (sidebar footer, `src/ui/AccountButton.tsx`): Google name/photo and Drive storage via `about` + summed file sizes (`src/sync/account.ts`, cached in localStorage); the avatar badge shows sync state (`syncTone`). Notebook cards show an upload icon while their pages are dirty.
- Lock screen opens automatically once the stored PIN length (`StoredPin.length`, learned on unlock for older PINs) is typed.
- Sync quick check: `driveChangesToken` meta + Drive changes feed; an idle device makes one small request. A full folder listing still runs on any foreign change, local change, or every 15 min.
- Logo: `scripts/make-icons.mjs` → `npm run icons` (see docs/CHANGE_LOGO.md). The launch screen in index.html is a plain background (no logo: a second logo next to the sidebar one looked odd), removed as soon as the first screen is drawn. No apple-touch-startup-image (iPadOS caches them per exact screen size, which looked odd).
- Night mode pages (`src/ink/inkTheme.ts`): per notebook `pageTheme`; ink is *displayed* with flipped lightness, stored colours never change. Renderer opacities multiply (`globalAlpha *=`), never assign.
- Page sizes (`src/model/pageSizes.ts`): each page has its own width/height; `setPageSize` scales ink by replacing strokes (tombstones). Notebook `pageSize` = size of new pages.
- Locks: app passcode is optional (`pinLock.skipped()`), notebook `lock` = PBKDF2 hash only; unlocked notebooks are kept in memory (`src/security/notebookLock.ts`).
- Selection (`src/ink/selection.ts`): `locked` items aren't selectable/erasable (long-press to unlock); `group` ids select together; align/distribute/flip/regroup always create new strokes.
- Ruler/protractor (`src/ink/guides.ts`): client-pixel overlay, never saved; strokes starting near an edge are projected onto it.
- Links: `stroke.link` (url/page/notebook) + PDF link annotations (`src/ink/links.ts`); exported PDFs keep them.
- Sharing (`src/share/`): view-only snapshot in a separate Drive folder, public via permission; locked notebooks are AES-GCM sealed with the passcode. Viewer route `#/s/<id>` needs `GOOGLE_API_KEY` (docs/SHARING_SETUP.md).
- Audio (`src/ink/recording.ts`, `RecordingsPanel`): notebook `recordings` (merge = union minus `deletedRecordingIds`), audio in files table, ink stamped with `audio: {rec, t}`.
- Design preview: branch `redesign` is built into `/noteboard/preview/` whenever main deploys. Restore point of the old look: tag `ui-v1`.
- Search (`src/search/`): local `pageText` table (Dexie v4, not synced) per page: handwriting read by Google Drive OCR (`DriveClient.readTextFromImage`: cropped ink JPEG uploaded as a temporary Google Doc outside the Noteboard folder, text exported, doc deleted), typed text boxes, PDF text + runs. `indexer.ts` runs after sync/online/every 5 min, one page at a time, never while writing; local-only and locked notebooks are never sent; locked (planner) strokes aren't OCR'd. Library search shows "In your notes"; the editor has a Find panel.
- PDF text (`src/pdf/pdfText.ts`, tested): copy line / page text (long-press), text in "Copy as text", and the text-aware highlighter (sideways swipe over PDF text → bands snapped to words).
- Zoom writing window (`src/ui/ZoomWindow.tsx`): magnified strip; ink goes through the editor's `onChange` (undo/sync as usual).
- Templates: Cornell / music / isometric are line templates (`templateLines`) drawn as SVG on screen and as lines in exports. Monthly planner (`src/ink/planner.ts`): locked text boxes/lines with page links.
- Study: notebook `bookmarks` (merged like recordings, `deletedBookmarkIds`), Contents panel, flashcards over tape (`setTapeRevealed`).
- Whiteboard pages: `page.grows`; ink near the right/bottom edge grows the page (merge keeps the larger size). Presentation mode: bars hidden, laser in hand.
- CI annotations (`scripts/ci-run.sh`) are how build errors are read without GitHub login — keep using it for new CI steps.

## Subagents (.claude/agents)
| Agent | Use for |
|---|---|
| `web-architect` | Design, data model changes, module boundaries |
| `ink-engine-engineer` | Pencil input, latency, rendering, tools, shape recognition |
| `library-engineer` | Folders, tags, search, trash, drag & drop, bulk actions |
| `drive-sync-engineer` | Google auth, Drive sync, merge rules, offline, backups |
| `export-engineer` | PDF/PNG export, PDF import & annotation |
| `pwa-ui-engineer` | iPad UX, layout, gestures, accessibility, PWA install/offline |
| `qa-engineer` | Tests and review for data loss / regressions before commits |
