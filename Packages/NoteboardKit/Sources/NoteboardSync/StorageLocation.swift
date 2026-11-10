import Foundation

/// Where the user's library lives. iCloud is preferred when available; the library
/// falls back to the local Documents directory (visible in Files under "On My iPad").
public enum StorageLocation: Sendable, Equatable {
    case local(URL)
    case iCloud(URL)

    public var libraryRoot: URL {
        switch self {
        case .local(let url), .iCloud(let url): url
        }
    }

    /// Resolves the library root. Call off the main actor: the ubiquity lookup can block.
    public static func resolve(preferICloud: Bool,
                               containerIdentifier: String? = nil,
                               fileManager: FileManager = .default) -> StorageLocation {
        if preferICloud,
           let container = fileManager.url(forUbiquityContainerIdentifier: containerIdentifier) {
            return .iCloud(container.appending(path: "Documents"))
        }
        let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return .local(documents)
    }
}
