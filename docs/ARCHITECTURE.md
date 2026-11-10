# Noteboard Architecture

## Goals
1. Writing must feel instant (Apple Pencil latency, 120 Hz) on notebooks with 1000+ pages.
2. User data is never lost: atomic writes, versioned format, conflict-safe sync, backups.
3. Organization is first-class: nested folders, tags, smart folders, search across handwriting and PDFs.
4. Native iPadOS citizen: multi-window, drag and drop, Files app, Spotlight, keyboard and pointer.

## Modules

| Module | Owns | Depends on |
|---|---|---|
| `NoteboardCore` | Value-type models (`NotebookManifest`, `PageDescriptor`, `PaperTemplate`), document package read/write, IDs, errors, logging | Foundation only |
| `NoteboardLibrary` | `LibraryEntry` index (SwiftData), folders, tags, smart-folder queries, trash, recents/favorites, search index, Spotlight | Core |
| `NoteboardCanvas` | Canvas views, tools, page virtualization, templates rendering, undo | Core, PencilKit |
| `NoteboardPDF` | PDF import, page rendering/thumbnails, export (flattened / annotated) | Core, PDFKit |
| `NoteboardSync` | Ubiquity container, file coordination, `NSFileVersion` conflicts, backups | Core |
| `App` | Scenes, navigation, dependency composition, settings | all modules |

## Document format: `.noteboard` package
A directory bundle (UTType `com.noteboard.notebook`, conforms to `com.apple.package`) so iCloud syncs per-file and conflicts stay page-sized.

```
My Notes.noteboard/
  manifest.json            NotebookManifest (formatVersion, id, title, page order, cover, timestamps)
  pages/<pageID>.drawing   PKDrawing dataRepresentation per page
  pages/<pageID>.json      Page metadata: template, size, background ref, text boxes, images
  assets/<sha256>.<ext>    Content-addressed images / stickers
  sources/<id>.pdf         Imported PDFs, never modified (pages reference sourceID + pageIndex)
  thumbnails/<pageID>.jpg  Cache, safe to delete
```
- `formatVersion` is an integer. Readers migrate older versions forward on open; they refuse newer versions with a clear message.
- Saves are per-page and atomic (`Data.write(options: .atomic)` inside file coordination).

## Library model
- **Source of truth**: the folder hierarchy on disk inside the app's Documents (or iCloud Drive) container. A Noteboard folder is a real directory, so the library is browsable in the Files app.
- **Index**: SwiftData `LibraryEntry` rows mirror disk (path, kind, title, dates, tags, favorite, color, trashed state, extracted text). `LibraryIndexer.rebuild()` can regenerate it from disk at any time.
- Tags, colors, favorites and manual sort order live in the index and are also written to the package/folder metadata (`.noteboard-folder.json` / manifest) so they survive an index rebuild and sync between devices.
- **Trash**: items move to `.Trash/` with their original path recorded; auto-purge after 30 days.
- **Smart folders**: a stored `LibraryQuery` (tags any/all, kinds, date range, text, favorites) evaluated against the index.

## Concurrency
- Swift 6 strict concurrency. UI on `@MainActor`; disk and index work in actors (`DocumentStore`, `LibraryIndexer`).
- Canvas saves are debounced (≈1 s idle) and flushed on scene background.

## Dependencies
None beyond Apple SDKs. Add rows here with justification before adding any package.
