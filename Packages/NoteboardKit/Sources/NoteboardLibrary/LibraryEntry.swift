import Foundation
import NoteboardCore

/// Value snapshot of an entry in the library (folder, notebook, or PDF).
/// The SwiftData index (M1) stores these fields; queries and UI work on this type.
public struct LibraryEntry: Sendable, Hashable, Identifiable {
    public enum Kind: String, Sendable, Codable, CaseIterable {
        case folder, notebook, pdf
    }

    public var id: UUID
    public var kind: Kind
    public var title: String
    /// Path relative to the library root, e.g. "School/Physics/Lecture 1.noteboard".
    public var relativePath: String
    public var tags: Set<String>
    public var isFavorite: Bool
    public var colorHex: String?
    public var createdAt: Date
    public var modifiedAt: Date
    public var lastOpenedAt: Date?
    /// Text extracted from typed text, PDF text, and recognized handwriting.
    public var searchableText: String

    public init(id: UUID = UUID(), kind: Kind, title: String, relativePath: String,
                tags: Set<String> = [], isFavorite: Bool = false, colorHex: String? = nil,
                createdAt: Date = .now, modifiedAt: Date = .now, lastOpenedAt: Date? = nil,
                searchableText: String = "") {
        self.id = id
        self.kind = kind
        self.title = title
        self.relativePath = relativePath
        self.tags = tags
        self.isFavorite = isFavorite
        self.colorHex = colorHex
        self.createdAt = createdAt
        self.modifiedAt = modifiedAt
        self.lastOpenedAt = lastOpenedAt
        self.searchableText = searchableText
    }
}

public enum LibrarySort: String, Sendable, Codable, CaseIterable {
    case title, dateCreated, dateModified, lastOpened

    public func sorted(_ items: [LibraryEntry], ascending: Bool = true) -> [LibraryEntry] {
        let result = items.sorted { a, b in
            // Folders always first, like Files.app.
            if (a.kind == .folder) != (b.kind == .folder) { return a.kind == .folder }
            switch self {
            case .title:
                return a.title.localizedStandardCompare(b.title) == .orderedAscending
            case .dateCreated:
                return a.createdAt < b.createdAt
            case .dateModified:
                return a.modifiedAt < b.modifiedAt
            case .lastOpened:
                return (a.lastOpenedAt ?? .distantPast) < (b.lastOpenedAt ?? .distantPast)
            }
        }
        if ascending { return result }
        // Reverse within the folder / non-folder groups, keeping folders first.
        let folders = result.filter { $0.kind == .folder }.reversed()
        let others = result.filter { $0.kind != .folder }.reversed()
        return Array(folders) + Array(others)
    }
}
