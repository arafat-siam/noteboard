import Foundation

/// A saved search that powers Smart Folders.
public struct LibraryQuery: Codable, Sendable, Hashable {
    public enum TagMatch: String, Codable, Sendable { case any, all }

    public var text: String?
    public var tags: Set<String>
    public var tagMatch: TagMatch
    public var kinds: Set<LibraryEntry.Kind>
    public var favoritesOnly: Bool
    public var modifiedAfter: Date?
    public var modifiedBefore: Date?
    /// Restrict to items under this folder path (relative to library root). `nil` = whole library.
    public var withinFolder: String?

    public init(text: String? = nil, tags: Set<String> = [], tagMatch: TagMatch = .any,
                kinds: Set<LibraryEntry.Kind> = [], favoritesOnly: Bool = false,
                modifiedAfter: Date? = nil, modifiedBefore: Date? = nil, withinFolder: String? = nil) {
        self.text = text
        self.tags = tags
        self.tagMatch = tagMatch
        self.kinds = kinds
        self.favoritesOnly = favoritesOnly
        self.modifiedAfter = modifiedAfter
        self.modifiedBefore = modifiedBefore
        self.withinFolder = withinFolder
    }

    public func matches(_ item: LibraryEntry) -> Bool {
        if !kinds.isEmpty, !kinds.contains(item.kind) { return false }
        if favoritesOnly, !item.isFavorite { return false }
        if let after = modifiedAfter, item.modifiedAt < after { return false }
        if let before = modifiedBefore, item.modifiedAt > before { return false }

        if let folder = withinFolder, !folder.isEmpty {
            let prefix = folder.hasSuffix("/") ? folder : folder + "/"
            if !item.relativePath.hasPrefix(prefix) { return false }
        }

        if !tags.isEmpty {
            switch tagMatch {
            case .any: if tags.isDisjoint(with: item.tags) { return false }
            case .all: if !tags.isSubset(of: item.tags) { return false }
            }
        }

        if let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
            let haystacks = [item.title, item.searchableText]
            let found = haystacks.contains {
                $0.range(of: text, options: [.caseInsensitive, .diacriticInsensitive]) != nil
            }
            if !found { return false }
        }
        return true
    }
}

/// A named, user-created saved search shown in the sidebar.
public struct SmartFolder: Codable, Sendable, Hashable, Identifiable {
    public var id: UUID
    public var name: String
    public var symbolName: String
    public var query: LibraryQuery

    public init(id: UUID = UUID(), name: String, symbolName: String = "sparkle.magnifyingglass",
                query: LibraryQuery) {
        self.id = id
        self.name = name
        self.symbolName = symbolName
        self.query = query
    }
}
