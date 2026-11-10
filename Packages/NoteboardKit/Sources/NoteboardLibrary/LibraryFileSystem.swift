import Foundation
import NoteboardCore

public enum LibraryFileSystemError: Error, Equatable, Sendable {
    case itemNotFound(String)
    case destinationExists(String)
    case notInTrash(String)
    case invalidName
    case invalidDestination
}

/// An item sitting in the library trash.
public struct TrashEntry: Sendable, Hashable, Identifiable {
    public let entry: String
    public let originalRelativePath: String
    public let trashedAt: Date

    public var id: String { entry }

    public var title: String {
        let name = (originalRelativePath as NSString).lastPathComponent
        guard (name as NSString).pathExtension == NotebookPackage.fileExtension else { return name }
        return (name as NSString).deletingPathExtension
    }

    /// Folder the item came from ("" = library root).
    public var originalFolder: String {
        (originalRelativePath as NSString).deletingLastPathComponent
    }
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

    public nonisolated let root: URL
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

    static func join(_ parent: String, _ name: String) -> String {
        parent.isEmpty ? name : "\(parent)/\(name)"
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

    // MARK: Listing

    /// Folders and notebooks directly inside `folder` (unsorted).
    public func contents(of folder: String = "") throws -> [LibraryItem] {
        let keys: [URLResourceKey] = [.isDirectoryKey, .creationDateKey, .contentModificationDateKey]
        let urls = try fileManager.contentsOfDirectory(
            at: url(for: folder), includingPropertiesForKeys: keys, options: [.skipsHiddenFiles])

        var items: [LibraryItem] = []
        for itemURL in urls {
            let values = try itemURL.resourceValues(forKeys: Set(keys))
            guard values.isDirectory == true else { continue }
            let relative = Self.join(folder, itemURL.lastPathComponent)

            if itemURL.pathExtension == NotebookPackage.fileExtension {
                // TODO(M1): surface unreadable notebooks instead of hiding them.
                guard let manifest = try? NotebookPackage(url: itemURL).readManifest() else { continue }
                items.append(LibraryItem(
                    id: manifest.id, kind: .notebook, title: manifest.title, relativePath: relative,
                    tags: Set(manifest.tags), colorHex: manifest.coverColorHex,
                    createdAt: manifest.createdAt, modifiedAt: manifest.modifiedAt))
            } else {
                let created = values.creationDate ?? .now
                items.append(LibraryItem(
                    kind: .folder, title: itemURL.lastPathComponent, relativePath: relative,
                    createdAt: created, modifiedAt: values.contentModificationDate ?? created))
            }
        }
        return items
    }

    /// Returns `base`, or "base 2", "base 3"… so nothing in `parent` is overwritten.
    public func availableName(_ base: String, in parent: String = "", fileExtension: String? = nil) -> String {
        func fileName(_ name: String) -> String {
            fileExtension.map { "\(name).\($0)" } ?? name
        }
        var candidate = base
        var counter = 2
        while exists(url(for: Self.join(parent, fileName(candidate)))) {
            candidate = "\(base) \(counter)"
            counter += 1
        }
        return candidate
    }

    // MARK: Creating

    /// Creates a folder and returns its relative path.
    @discardableResult
    public func createFolder(named name: String, in parent: String = "") throws -> String {
        try validate(name)
        guard !name.hasSuffix(".\(NotebookPackage.fileExtension)") else {
            throw LibraryFileSystemError.invalidName
        }
        let relative = Self.join(parent, name)
        let target = url(for: relative)
        guard !exists(target) else { throw LibraryFileSystemError.destinationExists(relative) }
        try fileManager.createDirectory(at: target, withIntermediateDirectories: true)
        return relative
    }

    /// Creates an empty one-page notebook and returns its relative path.
    @discardableResult
    public func createNotebook(named name: String, in parent: String = "",
                               template: PaperTemplate = .ruled) throws -> String {
        try validate(name)
        let relative = Self.join(parent, "\(name).\(NotebookPackage.fileExtension)")
        let target = url(for: relative)
        guard !exists(target) else { throw LibraryFileSystemError.destinationExists(relative) }
        let manifest = NotebookManifest(
            title: name, pages: [PageDescriptor(background: .template(template, paperColorHex: "#FFFFFF"))])
        try NotebookPackage.create(at: target, manifest: manifest, fileManager: fileManager)
        return relative
    }

    // MARK: Moving & renaming

    /// Moves an item into another folder. Returns the new relative path.
    @discardableResult
    public func move(_ relativePath: String, toFolder destination: String) throws -> String {
        let source = url(for: relativePath)
        guard exists(source) else { throw LibraryFileSystemError.itemNotFound(relativePath) }
        guard destination != relativePath, !destination.hasPrefix(relativePath + "/") else {
            throw LibraryFileSystemError.invalidDestination   // folder into itself
        }
        guard exists(url(for: destination)) else { throw LibraryFileSystemError.itemNotFound(destination) }

        let newRelative = Self.join(destination, source.lastPathComponent)
        if newRelative == relativePath { return relativePath }
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

        let isNotebook = source.pathExtension == NotebookPackage.fileExtension
        let finalName = isNotebook ? "\(newName).\(NotebookPackage.fileExtension)" : newName
        let parent = (relativePath as NSString).deletingLastPathComponent
        let newRelative = Self.join(parent, finalName)
        if newRelative == relativePath { return relativePath }

        let target = url(for: newRelative)
        guard !exists(target) else { throw LibraryFileSystemError.destinationExists(newRelative) }
        try fileManager.moveItem(at: source, to: target)

        if isNotebook {
            let package = NotebookPackage(url: target)
            var manifest = try package.readManifest()
            manifest.title = newName
            manifest.modifiedAt = .now
            try package.writeManifest(manifest)
        }
        return newRelative
    }

    // MARK: Trash

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

    /// Everything currently in the trash, newest first.
    public func trashContents() throws -> [TrashEntry] {
        try fileManager.contentsOfDirectory(at: trashURL, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasSuffix(Self.trashRecordSuffix) }
            .compactMap { recordURL -> TrashEntry? in
                guard let record = try? JSONDecoder().decode(TrashRecord.self, from: Data(contentsOf: recordURL))
                else { return nil }
                let entry = String(recordURL.lastPathComponent.dropLast(Self.trashRecordSuffix.count))
                return TrashEntry(entry: entry, originalRelativePath: record.originalRelativePath,
                                  trashedAt: record.trashedAt)
            }
            .sorted { $0.trashedAt > $1.trashedAt }
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
        for entry in try trashContents() where entry.trashedAt < cutoff {
            let itemURL = trashURL.appending(path: entry.entry)
            if exists(itemURL) { try fileManager.removeItem(at: itemURL) }
            try fileManager.removeItem(at: trashURL.appending(path: entry.entry + Self.trashRecordSuffix))
            purged += 1
        }
        return purged
    }
}
