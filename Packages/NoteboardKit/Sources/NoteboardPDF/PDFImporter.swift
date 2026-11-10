#if canImport(PDFKit)
import Foundation
import PDFKit
import NoteboardCore

public enum PDFImportError: Error, Sendable {
    case unreadable
    case locked
}

/// Imports a PDF into a new `.noteboard` package. The original PDF is copied into
/// `sources/` untouched and each PDF page becomes a notebook page referencing it.
public struct PDFImporter: Sendable {
    public init() {}

    public func importPDF(at pdfURL: URL, intoPackageAt packageURL: URL,
                          title: String? = nil) throws -> NotebookManifest {
        guard let document = PDFDocument(url: pdfURL) else { throw PDFImportError.unreadable }
        guard !document.isLocked else { throw PDFImportError.locked }

        let sourceID = UUID()
        var pages: [PageDescriptor] = []
        for index in 0..<document.pageCount {
            guard let page = document.page(at: index) else { continue }
            let bounds = page.bounds(for: .mediaBox)
            pages.append(PageDescriptor(
                size: PageSize(width: bounds.width, height: bounds.height),
                background: .pdf(sourceID: sourceID, pageIndex: index)))
        }

        let manifest = NotebookManifest(
            title: title ?? pdfURL.deletingPathExtension().lastPathComponent, pages: pages)
        let package = try NotebookPackage.create(at: packageURL, manifest: manifest)
        try FileManager.default.copyItem(at: pdfURL, to: package.sourcePDFURL(for: sourceID))
        return manifest
    }
}
#endif
