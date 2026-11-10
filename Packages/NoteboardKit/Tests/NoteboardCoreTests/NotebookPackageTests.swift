import Foundation
import Testing
@testable import NoteboardCore

struct NotebookPackageTests {
    private func tempPackageURL() -> URL {
        FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appending(path: "Test.\(NotebookPackage.fileExtension)")
    }

    @Test func manifestRoundTrips() throws {
        let url = tempPackageURL()
        let pdfSource = UUID()
        let manifest = NotebookManifest(
            title: "Physics",
            pages: [PageDescriptor(), PageDescriptor(background: .pdf(sourceID: pdfSource, pageIndex: 3))],
            tags: ["school"])

        let package = try NotebookPackage.create(at: url, manifest: manifest)
        let loaded = try package.readManifest()

        #expect(loaded.id == manifest.id)
        #expect(loaded.title == "Physics")
        #expect(loaded.pages.count == 2)
        #expect(loaded.pages[1].background == .pdf(sourceID: pdfSource, pageIndex: 3))
        #expect(loaded.formatVersion == NotebookManifest.currentFormatVersion)
    }

    @Test func rejectsNewerFormatVersion() throws {
        let url = tempPackageURL()
        let package = try NotebookPackage.create(at: url, manifest: NotebookManifest(title: "X"))
        var json = try JSONSerialization.jsonObject(with: Data(contentsOf: package.manifestURL)) as! [String: Any]
        json["formatVersion"] = NotebookManifest.currentFormatVersion + 1
        try JSONSerialization.data(withJSONObject: json).write(to: package.manifestURL)

        #expect(throws: NotebookPackageError.unsupportedFormatVersion(NotebookManifest.currentFormatVersion + 1)) {
            try package.readManifest()
        }
    }

    @Test func drawingDataRoundTrips() throws {
        let package = try NotebookPackage.create(at: tempPackageURL(), manifest: NotebookManifest(title: "X"))
        let pageID = UUID()
        #expect(try package.readDrawing(for: pageID) == nil)
        try package.writeDrawing(Data([1, 2, 3]), for: pageID)
        #expect(try package.readDrawing(for: pageID) == Data([1, 2, 3]))
    }
}
