import Foundation
import NoteboardCore

public enum LibraryFileSystemError: Error, Equatable, Sendable {
    case itemNotFound(String)
    case destinationExists(String)
    case notInTrash(String)
    case invalidName
}

/// Disk-level folder operations for the library. The file system is the source of truth;
/// the index observes these changes. Runs off the main actor.
public actor LibraryFileSystem {
    public static let trashDirectoryName = ".Trash"
    static let trashRecordSuffix = ".trashinfo.json"

    struct TrashRecord: Codable {
        var originalRelativePath: String
        var trashedAt: Date
    }

    public let root: URL
    private let fileManager = FileManager.default

    public init(root: URL) throws {
        self.root = root
        try FileManager.default.createDirectory(
            at: root.appending(path: Self.trashDirectoryName), withIntermediateDirectories: true)
    }

    var trashURL: URL { root.appending(path: Self.trashDirectoryName) }

    func url(for relativePath: String) -> URL {
        relativePath.isEmpty ? root : root.appending(path: relativePath)
    }

    private func exists(_ url: URL) -> Bool {
        fileManager.fileExists(atPath: url.path(percentEncoded: false))
    }

    private func validate(_ name: String) throws {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("/"), !trimmed.hasPrefix(".") else {
            throw LibraryFileSystemError.invalidName
        }
    }

    /// Creates a folder and returns its relative path.
    @discardableResult
    public func createFolder(named name: String, in parent: String = "") throws -> String {
        try validate(name)
        let relative = parent.isEmpty ? name : "\(parent)/\(name)"
        let target = url(for: relative)
        guard !exists(target) else { throw LibraryFileSystemError.destinationExists(relative) }
        try fileManager.createDirectory(at: target, withIntermediateDirectories: true)
        return relative
    }

    /// Moves an item into another folder. Returns the new relative path.
    @discardableResult
    public func move(_ relativePath: String, toFolder destination: String) throws -> String {
        let source = url(for: relativePath)
        guard exists(source) else { throw LibraryFileSystemError.itemNotFound(relativePath) }
        let name = source.lastPathComponent
        let newRelative = destination.isEmpty ? name : "\(destination)/\(name)"
        let target = url(for: newRelative)
        guard !exists(target) else { throw LibraryFileSystemError.destinationExists(newRelative) }
        try fileManager.moveItem(at: source, to: target)
        return newRelative
    }

    @discardableResult
    public func rename(_ relativePath: String, to newName: String) throws -> String {
        try validate(newName)
        let source = url(for: relativePath)
        guard exists(source) else { throw LibraryFileSystemError.itemNotFound(relativePath) }
        let ext = source.pathExtension
        let finalName = ext.isEmpty || newName.hasSuffix(".\(ext)") ? newName : "\(newName).\(ext)"
        let target = source.deletingLastPathComponent().appending(path: finalName)
        guard !exists(target) else { throw LibraryFileSystemError.destinationExists(finalName) }
        try fileManager.moveItem(at: source, to: target)
        let parent = (relativePath as NSString).deletingLastPathComponent
        return parent.isEmpty ? finalName : "\(parent)/\(finalName)"
    }

    /// Moves an item to the library trash, remembering where it came from.
    /// Returns the trash entry name used for `restore`.
    @discardableResult
    public func moveToTrash(_ relativePath: String, now: Date = .now) throws -> String {
        let source = url(for: relativePath)
        guard exists(source) else { throw LibraryFileSystemError.itemNotFound(relativePath) }
        let entry = "\(UUID().uuidString)-\(source.lastPathComponent)"
        try fileManager.moveItem(at: source, to: trashURL.appending(path: entry))
        let record = TrashRecord(originalRelativePath: relativePath, trashedAt: now)
        try JSONEncoder().encode(record)
            .write(to: trashURL.appending(path: entry + Self.trashRecordSuffix), options: .atomic)
        return entry
    }

    /// Restores a trashed item to its original location (recreating parent folders).
    @discardableResult
    public func restore(trashEntry entry: String) throws -> String {
        let itemURL = trashURL.appending(path: entry)
        let recordURL = trashURL.appending(path: entry + Self.trashRecordSuffix)
        guard exists(itemURL), exists(recordURL) else { throw LibraryFileSystemError.notInTrash(entry) }
        let record = try JSONDecoder().decode(TrashRecord.self, from: Data(contentsOf: recordURL))
        let target = url(for: record.originalRelativePath)
        guard !exists(target) else {
            throw LibraryFileSystemError.destinationExists(record.originalRelativePath)
        }
        try fileManager.createDirectory(at: target.deletingLastPathComponent(),
                                        withIntermediateDirectories: true)
        try fileManager.moveItem(at: itemURL, to: target)
        try fileManager.removeItem(at: recordURL)
        return record.originalRelativePath
    }

    /// Permanently deletes trash entries older than `days`.
    @discardableResult
    public func purgeTrash(olderThan days: Int = 30, now: Date = .now) throws -> Int {
        let cutoff = now.addingTimeInterval(-Double(days) * 86_400)
        var purged = 0
        for recordURL in try fileManager.contentsOfDirectory(at: trashURL, includingPropertiesForKeys: nil)
        where recordURL.lastPathComponent.hasSuffix(Self.trashRecordSuffix) {
            let record = try JSONDecoder().decode(TrashRecord.self, from: Data(contentsOf: recordURL))
            guard record.trashedAt < cutoff else { continue }
            let entry = String(recordURL.lastPathComponent.dropLast(Self.trashRecordSuffix.count))
            let itemURL = trashURL.appending(path: entry)
            if exists(itemURL) { try fileManager.removeItem(at: itemURL) }
            try fileManager.removeItem(at: recordURL)
            purged += 1
        }
        return purged
    }
}
