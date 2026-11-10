import Foundation
import Observation
import NoteboardCore
import NoteboardLibrary
import NoteboardSync

/// Composition root: owns long-lived services, sidebar state and the current folder listing.
@MainActor
@Observable
final class AppModel {
    enum SidebarSelection: Hashable {
        case library
        case favorites
        case recents
        case tag(String)
        case smartFolder(UUID)
        case trash
    }

    var selection: SidebarSelection? = .library
    /// Folder shown in the library browser, relative to the library root ("" = root).
    private(set) var currentFolder = ""
    private(set) var items: [LibraryEntry] = []
    private(set) var trashEntries: [TrashEntry] = []
    var sort: LibrarySort = .title {
        didSet { items = sort.sorted(items) }
    }
    var openNotebookPath: String?
    var smartFolders: [SmartFolder] = []
    var tags: [String] = []
    var errorMessage: String?

    private(set) var libraryRoot: URL?
    @ObservationIgnored private var fileSystem: LibraryFileSystem?

    func bootstrap() async {
        guard fileSystem == nil else { return }
        do {
            let location = await Task.detached { StorageLocation.resolve(preferICloud: false) }.value
            let fileSystem = try LibraryFileSystem(root: location.libraryRoot)
            self.fileSystem = fileSystem
            libraryRoot = location.libraryRoot
            try await fileSystem.purgeTrash()
        } catch {
            report(error)
        }
        await reload()
    }

    func reload() async {
        guard let fileSystem else { return }
        do {
            items = sort.sorted(try await fileSystem.contents(of: currentFolder))
            trashEntries = try await fileSystem.trashContents()
        } catch {
            report(error)
        }
    }

    // MARK: Navigation

    var currentFolderTitle: String {
        currentFolder.isEmpty
            ? String(localized: "Library")
            : (currentFolder as NSString).lastPathComponent
    }

    var parentFolder: String? {
        currentFolder.isEmpty ? nil : (currentFolder as NSString).deletingLastPathComponent
    }

    func open(_ item: LibraryEntry) {
        switch item.kind {
        case .folder: show(folder: item.relativePath)
        case .notebook, .pdf: openNotebookPath = item.relativePath
        }
    }

    func show(folder: String) {
        currentFolder = folder
        Task { await reload() }
    }

    func notebookURL(for relativePath: String) -> URL? {
        libraryRoot?.appending(path: relativePath)
    }

    // MARK: Library operations

    func createFolder() async {
        await perform { fileSystem in
            let name = await fileSystem.availableName(String(localized: "New Folder"), in: self.currentFolder)
            try await fileSystem.createFolder(named: name, in: self.currentFolder)
        }
    }

    func createNotebook() async {
        await perform { fileSystem in
            let name = await fileSystem.availableName(
                String(localized: "Untitled Notebook"), in: self.currentFolder,
                fileExtension: NotebookPackage.fileExtension)
            self.openNotebookPath = try await fileSystem.createNotebook(named: name, in: self.currentFolder)
        }
    }

    func rename(_ item: LibraryEntry, to newName: String) async {
        await perform { fileSystem in
            let newPath = try await fileSystem.rename(item.relativePath, to: newName)
            self.updateOpenNotebook(from: item.relativePath, to: newPath)
        }
    }

    func move(_ paths: [String], into folder: String) async {
        await perform { fileSystem in
            for path in paths where path != folder {
                let newPath = try await fileSystem.move(path, toFolder: folder)
                self.updateOpenNotebook(from: path, to: newPath)
            }
        }
    }

    func moveToTrash(_ item: LibraryEntry) async {
        await perform { fileSystem in
            try await fileSystem.moveToTrash(item.relativePath)
            self.updateOpenNotebook(from: item.relativePath, to: nil)
        }
    }

    func restore(_ entry: TrashEntry) async {
        await perform { fileSystem in
            try await fileSystem.restore(trashEntry: entry.entry)
        }
    }

    private func perform(_ operation: (LibraryFileSystem) async throws -> Void) async {
        guard let fileSystem else { return }
        do {
            try await operation(fileSystem)
        } catch {
            report(error)
        }
        await reload()
    }

    /// Keeps the open notebook pointing at the right place after it (or a parent folder) moves.
    private func updateOpenNotebook(from oldPath: String, to newPath: String?) {
        guard let open = openNotebookPath else { return }
        if open == oldPath {
            openNotebookPath = newPath
        } else if open.hasPrefix(oldPath + "/") {
            openNotebookPath = newPath.map { $0 + open.dropFirst(oldPath.count) }
        }
    }

    private func report(_ error: Error) {
        errorMessage = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
    }
}
