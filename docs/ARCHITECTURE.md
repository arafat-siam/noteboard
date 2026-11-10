# Noteboard Architecture

## Goals
1. Ink that feels precise and immediate with Apple Pencil in iPad Safari.
2. Never lose user data: local-first, conflict-free merges, Google Drive as durable storage, backups.
3. Best-in-class organization: nested folders, tags, favorites, recents, search, trash, drag & drop, bulk actions.
4. Zero cost: static hosting (GitHub Pages), the user's own Google Drive, no backend.

## Data model (`src/model/types.ts`)
- **LibraryItem** = Folder | Notebook. Tree via `parentId`. `trashedAt` (Trash), `deleted` (purged tombstone, kept so the deletion syncs), `updatedAt` for last-writer-wins.
- **Notebook** keeps `pageIds` (order) and `deletedPageIds` (page tombstones).
- **Page**: template, size in page units (A4 at 96 dpi = 794×1123), `strokes`, `deletedStrokeIds`, `dirty`.
- **Stroke** is immutable: `{id, tool, color, size, points:[x,y,pressure…], hasPressure}`. Moving a stroke = delete + add with a new id.

## Local storage
IndexedDB via Dexie (`src/db/db.ts`): `items`, `pages`, `meta` (library revision, Drive folder id), `sync` (Drive file id + last seen `modifiedTime` per record).

## Ink pipeline (`src/ink/InkPage.tsx`)
- Pointer Events; `getCoalescedEvents()` captures every digitizer sample; `getPredictedEvents()` extends the live stroke to hide latency (prediction is never saved).
- Two canvases per visible page: committed ink + live layer. Paper templates are CSS gradients (no canvas memory). Canvases exist only for pages near the viewport.
- `perfect-freehand` with low streamline (0.12) for precision; pressure from Pencil, simulated for finger/mouse.
- Palm rejection: touch contacts never draw while the Pencil was used in the last 1.5 s; by default fingers only scroll/zoom.
- Hold-to-snap: holding the Pencil still for 0.5 s runs `recognizeShape` (line, circle, ellipse, triangle, rectangle, polygon).
- Tools: pen, highlighter (multiply blend, drawn under ink), stroke eraser, lasso (move / duplicate / delete).
- Undo/redo per editor session; undoing an erase re-adds copies with new ids (old ids stay tombstoned for sync).

## Google Drive sync (`src/sync/`)
- **Auth**: OAuth 2.0 token flow with full-page redirect (popups are unreliable in home-screen apps). Scope `drive.file`: the app sees only files it created. Tokens last ~1 h; on launch the app silently renews via redirect (`prompt=none`). No refresh tokens (no backend).
- **Layout in Drive**: a visible `Noteboard` folder containing `library.json` and one `page_<id>.json` per page.
- **Cycle** (`SyncEngine.run`): list folder → pull changed files (compare `modifiedTime`) → merge → push library if `libraryRev` changed → push dirty pages. Runs on launch, 4 s after edits, every 60 s, on reconnect and when the app goes to background.
- **Merge rules** (`merge.ts`): pages = union of strokes minus tombstones (two devices writing offline never lose ink); library items = last-writer-wins per item, purge is sticky, notebook page lists union minus page tombstones.

## Export (`src/export/`)
Vector PDF (pdf-lib, lazy-loaded), PNG per page, JSON backup export/import (merged, never overwrites newer work). iPad share sheet via Web Share API.

## Apple Pencil double-tap / squeeze
Not exposed to web pages by iPadOS. `src/pencil/bridge.ts` defines `window.noteboardPencil()` for an optional native WKWebView wrapper. Note: Google blocks OAuth inside embedded web views, so a wrapper must sign in via `ASWebAuthenticationSession` and hand the token to the page.

## Dependencies
| Package | Why |
|---|---|
| react, react-dom | UI |
| dexie, dexie-react-hooks | IndexedDB with transactions and live queries |
| perfect-freehand | Pressure-sensitive stroke outlines (MIT) |
| pdf-lib | PDF export, later PDF import/annotation |
| vite-plugin-pwa | Service worker + manifest |
