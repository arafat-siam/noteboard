import Foundation

public enum NotebookPackageError: Error, Equatable, Sendable {
    case missingManifest
    case unsupportedFormatVersion(Int)
}

/// Reads and writes the `.noteboard` package layout described in docs/ARCHITECTURE.md.
/// All writes are atomic. Callers are responsible for file coordination when the
/// package lives in iCloud (see NoteboardSync).
public struct NotebookPackage: Sendable {
    public static let fileExtension = "noteboard"

    public enum Path {
        public static let manifest = "manifest.json"
        public static let pages = "pages"
        public static let assets = "assets"
        public static let sources = "sources"
        public static let thumbnails = "thumbnails"
    }

    public let url: URL

    public init(url: URL) {
        self.url = url
    }

    public var manifestURL: URL { url.appending(path: Path.manifest) }

    public func drawingURL(for pageID: UUID) -> URL {
        url.appending(path: Path.pages).appending(path: "\(pageID.uuidString).drawing")
    }

    public func sourcePDFURL(for sourceID: UUID) -> URL {
        url.appending(path: Path.sources).appending(path: "\(sourceID.uuidString).pdf")
    }

    /// Creates a new package directory with an initial manifest.
    @discardableResult
    public static func create(at url: URL, manifest: NotebookManifest,
                              fileManager: FileManager = .default) throws -> NotebookPackage {
        try fileManager.createDirectory(at: url, withIntermediateDirectories: true)
        for dir in [Path.pages, Path.assets, Path.sources, Path.thumbnails] {
            try fileManager.createDirectory(at: url.appending(path: dir), withIntermediateDirectories: true)
        }
        let package = NotebookPackage(url: url)
        try package.writeManifest(manifest)
        return package
    }

    public func readManifest() throws -> NotebookManifest {
        guard FileManager.default.fileExists(atPath: manifestURL.path(percentEncoded: false)) else {
            throw NotebookPackageError.missingManifest
        }
        let data = try Data(contentsOf: manifestURL)

        // Check the version before decoding the full model so newer files fail clearly.
        struct VersionProbe: Decodable { let formatVersion: Int }
        let version = try Self.decoder.decode(VersionProbe.self, from: data).formatVersion
        guard version <= NotebookManifest.currentFormatVersion else {
            throw NotebookPackageError.unsupportedFormatVersion(version)
        }
        return try Self.decoder.decode(NotebookManifest.self, from: data)
    }

    public func writeManifest(_ manifest: NotebookManifest) throws {
        let data = try Self.encoder.encode(manifest)
        try data.write(to: manifestURL, options: .atomic)
    }

    public func writeDrawing(_ data: Data, for pageID: UUID) throws {
        try data.write(to: drawingURL(for: pageID), options: .atomic)
    }

    public func readDrawing(for pageID: UUID) throws -> Data? {
        let url = drawingURL(for: pageID)
        guard FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) else { return nil }
        return try Data(contentsOf: url)
    }

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()
}
