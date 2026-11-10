# Noteboard

A handwriting and note-taking app for iPad with GoodNotes/Drawboard-level ink and PDF tools, plus proper folder, tag and smart-folder organization.

## Getting started (macOS + Xcode 16 or newer)
```bash
brew install xcodegen
xcodegen generate
open Noteboard.xcodeproj
```
Run the `Noteboard` scheme on an iPad simulator or device.

Package unit tests:
```bash
cd Packages/NoteboardKit && swift test
```

See [CLAUDE.md](CLAUDE.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/ROADMAP.md](docs/ROADMAP.md).
