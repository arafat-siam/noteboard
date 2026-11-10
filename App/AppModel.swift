import Foundation
import Observation
import NoteboardLibrary
import NoteboardSync

/// Composition root: owns long-lived services and sidebar state.
@MainActor
@Observable
final class AppModel {
    enum SidebarSelection: Hashable {
        case library(folder: String)   // "" = library root
        case favorites
        case recents
        case tag(String)
        case smartFolder(UUID)
        case trash
    }

    var selection: SidebarSelection? = .library(folder: "")
    var smartFolders: [SmartFolder] = []
    var tags: [String] = []
    var bootstrapError: String?

    private(set) var fileSystem: LibraryFileSystem?

    func bootstrap() async {
        do {
            let location = await Task.detached { StorageLocation.resolve(preferICloud: false) }.value
            fileSystem = try LibraryFileSystem(root: location.libraryRoot)
            _ = try await fileSystem?.purgeTrash()
        } catch {
            bootstrapError = error.localizedDescription
        }
    }
}
