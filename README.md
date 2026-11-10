# Noteboard

A handwriting and note-taking app for iPad with GoodNotes/Drawboard-level ink and PDF tools, plus proper folder, tag and smart-folder organization.

## Run it on your iPad (free, no Mac needed)

1. Install **Swift Playgrounds** from the App Store on your iPad.
2. On Windows, build the playground project:
   ```bash
   powershell -ExecutionPolicy Bypass -File scripts/build-playground.ps1
   ```
   This creates `Playground/Noteboard.swiftpm.zip`.
3. Get the zip onto the iPad (iCloud Drive, OneDrive, Google Drive, or email it to yourself). With iCloud for Windows installed you can copy straight into iCloud Drive:
   ```bash
   powershell -ExecutionPolicy Bypass -File scripts/build-playground.ps1 -Destination "$env:USERPROFILE\iCloudDrive"
   ```
4. In the iPad **Files** app, tap the zip to unzip it, then tap `Noteboard.swiftpm` — it opens in Swift Playgrounds.
5. Tap **Run** (▶). Use the expand button to run it full screen.

After changing code, run the script again and replace the old `Noteboard.swiftpm` on the iPad.

Not available in the Playgrounds build: iCloud sync, opening `.noteboard` files from Files, and multiple windows. Those need the full Xcode build.

## Full Xcode build (macOS + Xcode 16 or newer)
```bash
brew install xcodegen
xcodegen generate
open Noteboard.xcodeproj
```
Package unit tests: `cd Packages/NoteboardKit && swift test`. CI runs both on GitHub Actions.

See [CLAUDE.md](CLAUDE.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/ROADMAP.md](docs/ROADMAP.md).
