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
- Pencil must never scroll the page (touchstart with `touchType === 'stylus'` is prevented in NotebookEditor); fingers scroll.
- Google scope is `drive.file` only. No secrets in the repo (the OAuth client ID is public by design).
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
