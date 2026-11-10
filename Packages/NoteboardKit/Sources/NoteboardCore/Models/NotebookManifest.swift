import Foundation

/// Paper background drawn behind ink.
public enum PaperTemplate: String, Codable, Sendable, CaseIterable {
    case blank, ruled, narrowRuled, grid, dotted, cornell, planner
}

/// Page dimensions in points (1/72 inch).
public struct PageSize: Codable, Sendable, Hashable {
    public var width: Double
    public var height: Double

    public init(width: Double, height: Double) {
        self.width = width
        self.height = height
    }

    public static let a4 = PageSize(width: 595, height: 842)
    public static let letter = PageSize(width: 612, height: 792)
}

/// What sits underneath a page's ink.
public enum PageBackground: Codable, Sendable, Hashable {
    case template(PaperTemplate, paperColorHex: String)
    /// A page of an imported PDF stored in `sources/<sourceID>.pdf`.
    case pdf(sourceID: UUID, pageIndex: Int)
}

public struct PageDescriptor: Codable, Sendable, Hashable, Identifiable {
    public var id: UUID
    public var size: PageSize
    public var background: PageBackground

    public init(id: UUID = UUID(), size: PageSize = .a4,
                background: PageBackground = .template(.ruled, paperColorHex: "#FFFFFF")) {
        self.id = id
        self.size = size
        self.background = background
    }
}

/// Contents of `manifest.json` inside a `.noteboard` package.
public struct NotebookManifest: Codable, Sendable, Hashable, Identifiable {
    /// Bump when the on-disk format changes and add a migration in `NotebookMigrator`.
    public static let currentFormatVersion = 1

    public var formatVersion: Int
    public var id: UUID
    public var title: String
    public var pages: [PageDescriptor]
    public var tags: [String]
    public var coverColorHex: String
    public var createdAt: Date
    public var modifiedAt: Date

    public init(id: UUID = UUID(), title: String, pages: [PageDescriptor] = [PageDescriptor()],
                tags: [String] = [], coverColorHex: String = "#3A6EA5",
                createdAt: Date = .now, modifiedAt: Date = .now) {
        self.formatVersion = Self.currentFormatVersion
        self.id = id
        self.title = title
        self.pages = pages
        self.tags = tags
        self.coverColorHex = coverColorHex
        self.createdAt = createdAt
        self.modifiedAt = modifiedAt
    }
}
