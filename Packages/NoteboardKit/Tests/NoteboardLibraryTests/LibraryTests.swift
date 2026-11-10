import Foundation
import Testing
@testable import NoteboardLibrary

struct LibraryQueryTests {
    let physics = LibraryEntry(kind: .notebook, title: "Lecture 1", relativePath: "School/Physics/Lecture 1.noteboard",
                              tags: ["school", "exam"], isFavorite: true, searchableText: "Newton's laws")
    let recipe = LibraryEntry(kind: .pdf, title: "Pancakes", relativePath: "Home/Pancakes.noteboard", tags: ["food"])

    @Test func emptyQueryMatchesEverything() {
        #expect(LibraryQuery().matches(physics))
        #expect(LibraryQuery().matches(recipe))
    }

    @Test func tagMatchingAnyAndAll() {
        #expect(LibraryQuery(tags: ["exam", "food"], tagMatch: .any).matches(recipe))
        #expect(!LibraryQuery(tags: ["exam", "food"], tagMatch: .all).matches(recipe))
        #expect(LibraryQuery(tags: ["exam", "school"], tagMatch: .all).matches(physics))
    }

    @Test func textSearchesTitleAndContentCaseInsensitive() {
        #expect(LibraryQuery(text: "newton").matches(physics))
        #expect(LibraryQuery(text: "PANCAKE").matches(recipe))
        #expect(!LibraryQuery(text: "newton").matches(recipe))
    }

    @Test func folderScopeDoesNotMatchSiblingPrefix() {
        let sibling = LibraryEntry(kind: .notebook, title: "x", relativePath: "Schoolwork/x.noteboard")
        let query = LibraryQuery(withinFolder: "School")
        #expect(query.matches(physics))
        #expect(!query.matches(sibling))
    }

    @Test func kindAndFavoriteFilters() {
        #expect(!LibraryQuery(kinds: [.notebook]).matches(recipe))
        #expect(LibraryQuery(favoritesOnly: true).matches(physics))
        #expect(!LibraryQuery(favoritesOnly: true).matches(recipe))
    }
}

struct LibrarySortTests {
    @Test func foldersComeFirstInBothDirections() {
        let items = [
            LibraryEntry(kind: .notebook, title: "b", relativePath: "b"),
            LibraryEntry(kind: .folder, title: "z", relativePath: "z"),
            LibraryEntry(kind: .notebook, title: "a", relativePath: "a"),
        ]
        #expect(LibrarySort.title.sorted(items).map(\.title) == ["z", "a", "b"])
        #expect(LibrarySort.title.sorted(items, ascending: false).map(\.title) == ["z", "b", "a"])
    }
}

struct LibraryFileSystemTests {
    private func makeFS() throws -> LibraryFileSystem {
        try LibraryFileSystem(root: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString))
    }

    @Test func createMoveRename() async throws {
        let fs = try makeFS()
        try await fs.createFolder(named: "School")
        let physics = try await fs.createFolder(named: "Physics")
        let moved = try await fs.move(physics, toFolder: "School")
        #expect(moved == "School/Physics")
        let renamed = try await fs.rename(moved, to: "Mechanics")
        #expect(renamed == "School/Mechanics")
    }

    @Test func rejectsInvalidNames() async throws {
        let fs = try makeFS()
        await #expect(throws: LibraryFileSystemError.invalidName) { try await fs.createFolder(named: "a/b") }
        await #expect(throws: LibraryFileSystemError.invalidName) { try await fs.createFolder(named: ".hidden") }
    }

    @Test func trashAndRestoreRecreatesParents() async throws {
        let fs = try makeFS()
        try await fs.createFolder(named: "School")
        let physics = try await fs.createFolder(named: "Physics", in: "School")
        let entry = try await fs.moveToTrash(physics)
        let restored = try await fs.restore(trashEntry: entry)
        #expect(restored == "School/Physics")
        #expect(FileManager.default.fileExists(atPath: fs.root.appending(path: "School/Physics").path(percentEncoded: false)))
    }

    @Test func listsFoldersAndNotebooksWithManifestTitles() async throws {
        let fs = try makeFS()
        try await fs.createFolder(named: "School")
        try await fs.createNotebook(named: "Ideas")
        let items = try await fs.contents()
        #expect(Set(items.map(\.title)) == ["School", "Ideas"])
        #expect(items.first { $0.title == "Ideas" }?.kind == .notebook)
        #expect(items.first { $0.title == "Ideas" }?.relativePath == "Ideas.noteboard")
    }

    @Test func availableNameSkipsExistingItems() async throws {
        let fs = try makeFS()
        try await fs.createFolder(named: "New Folder")
        #expect(await fs.availableName("New Folder") == "New Folder 2")
        try await fs.createNotebook(named: "Untitled")
        #expect(await fs.availableName("Untitled", fileExtension: "noteboard") == "Untitled 2")
    }

    @Test func renamingNotebookUpdatesManifestTitle() async throws {
        let fs = try makeFS()
        let path = try await fs.createNotebook(named: "Draft")
        let renamed = try await fs.rename(path, to: "Final")
        #expect(renamed == "Final.noteboard")
        #expect(try await fs.contents().first?.title == "Final")
    }

    @Test func renamingFolderWithDotKeepsName() async throws {
        let fs = try makeFS()
        let path = try await fs.createFolder(named: "Notes")
        #expect(try await fs.rename(path, to: "Notes v1.2") == "Notes v1.2")
    }

    @Test func cannotMoveFolderIntoItself() async throws {
        let fs = try makeFS()
        try await fs.createFolder(named: "A")
        try await fs.createFolder(named: "B", in: "A")
        await #expect(throws: LibraryFileSystemError.invalidDestination) { try await fs.move("A", toFolder: "A/B") }
        await #expect(throws: LibraryFileSystemError.invalidDestination) { try await fs.move("A", toFolder: "A") }
    }

    @Test func trashContentsReportOriginalLocation() async throws {
        let fs = try makeFS()
        try await fs.createFolder(named: "School")
        let notebook = try await fs.createNotebook(named: "Physics", in: "School")
        try await fs.moveToTrash(notebook)
        let entries = try await fs.trashContents()
        #expect(entries.count == 1)
        #expect(entries.first?.title == "Physics")
        #expect(entries.first?.originalFolder == "School")
        #expect(try await fs.contents(of: "School").isEmpty)
    }

    @Test func purgeOnlyRemovesOldEntries() async throws {
        let fs = try makeFS()
        let old = try await fs.createFolder(named: "Old")
        let recent = try await fs.createFolder(named: "Recent")
        let now = Date()
        try await fs.moveToTrash(old, now: now.addingTimeInterval(-31 * 86_400))
        let recentEntry = try await fs.moveToTrash(recent, now: now)
        #expect(try await fs.purgeTrash(olderThan: 30, now: now) == 1)
        #expect(try await fs.restore(trashEntry: recentEntry) == "Recent")
    }
}
