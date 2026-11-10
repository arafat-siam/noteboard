#if canImport(UIKit) && canImport(PencilKit)
import SwiftUI
import PencilKit
import NoteboardCore

/// State for one open notebook: manifest, shared tool picker, and debounced page saves.
@MainActor
@Observable
public final class NotebookEditorModel {
    public let package: NotebookPackage
    public private(set) var manifest: NotebookManifest?
    public private(set) var loadError: String?
    public private(set) var saveError: String?
    public var allowsFingerDrawing = false

    @ObservationIgnored private var storedToolPicker: PKToolPicker?
    /// Latest in-memory drawing per edited page. Pages scrolled away and back read from here,
    /// so a save still waiting on its debounce can never be replaced by stale disk data.
    @ObservationIgnored private var editedDrawings: [UUID: PKDrawing] = [:]
    @ObservationIgnored private var saveTasks: [UUID: Task<Void, Never>] = [:]

    public init(packageURL: URL) {
        package = NotebookPackage(url: packageURL)
    }

    /// One tool picker shared by every page, created on first use.
    var toolPicker: PKToolPicker {
        if let storedToolPicker { return storedToolPicker }
        let picker = PKToolPicker()
        storedToolPicker = picker
        return picker
    }

    func load() async {
        guard manifest == nil else { return }
        let package = package
        do {
            manifest = try await Task.detached { try package.readManifest() }.value
        } catch {
            loadError = String(describing: error)
        }
    }

    func drawing(for pageID: UUID) async -> PKDrawing {
        if let edited = editedDrawings[pageID] { return edited }
        let package = package
        let data = try? await Task.detached { try package.readDrawing(for: pageID) }.value
        guard let data, let drawing = try? PKDrawing(data: data) else { return PKDrawing() }
        return drawing
    }

    func drawingChanged(_ drawing: PKDrawing, pageID: UUID) {
        editedDrawings[pageID] = drawing
        saveTasks[pageID]?.cancel()
        // Holds `self` strongly on purpose: closing the notebook must not drop a pending save.
        saveTasks[pageID] = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            await self.save(pageID: pageID)
        }
    }

    private func save(pageID: UUID) async {
        guard let drawing = editedDrawings[pageID], var updated = manifest else { return }
        let data = drawing.dataRepresentation()
        updated.modifiedAt = .now
        let snapshot = updated
        let package = package
        do {
            try await Task.detached {
                try package.writeDrawing(data, for: pageID)
                try package.writeManifest(snapshot)
            }.value
        } catch {
            saveError = String(describing: error)
        }
    }

    func addPage() {
        guard var updated = manifest else { return }
        let last = updated.pages.last
        var background = PageBackground.template(.ruled, paperColorHex: "#FFFFFF")
        if let last, case .template = last.background { background = last.background }
        updated.pages.append(PageDescriptor(size: last?.size ?? .a4, background: background))
        updated.modifiedAt = .now
        manifest = updated

        let package = package
        let snapshot = updated
        Task {
            do {
                try await Task.detached { try package.writeManifest(snapshot) }.value
            } catch {
                saveError = String(describing: error)
            }
        }
    }

    func clearSaveError() { saveError = nil }
}

/// Continuous vertical scroll of a notebook's pages with Apple Pencil ink.
public struct NotebookEditorView: View {
    @State private var model: NotebookEditorModel

    public init(packageURL: URL) {
        _model = State(initialValue: NotebookEditorModel(packageURL: packageURL))
    }

    public var body: some View {
        @Bindable var model = model
        Group {
            if let manifest = model.manifest {
                ScrollView {
                    LazyVStack(spacing: 24) {
                        ForEach(manifest.pages) { page in
                            NotebookPageView(page: page, model: model)
                                .frame(maxWidth: 900)
                        }
                        Button {
                            model.addPage()
                        } label: {
                            Label("Add Page", systemImage: "plus")
                        }
                        .buttonStyle(.bordered)
                        .padding(.bottom, 40)
                    }
                    .padding(24)
                    .frame(maxWidth: .infinity)
                }
                .background(Color(uiColor: .systemGroupedBackground))
                .navigationTitle(manifest.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItemGroup(placement: .primaryAction) {
                        Toggle(isOn: $model.allowsFingerDrawing) {
                            Label("Draw with Finger", systemImage: "hand.draw")
                        }
                        Button("Add Page", systemImage: "doc.badge.plus") { model.addPage() }
                    }
                }
            } else if let error = model.loadError {
                ContentUnavailableView("Can't Open Notebook", systemImage: "exclamationmark.triangle",
                                       description: Text(error))
            } else {
                ProgressView()
            }
        }
        .task { await model.load() }
        .alert("Couldn't Save", isPresented: Binding(
            get: { model.saveError != nil },
            set: { if !$0 { model.clearSaveError() } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.saveError ?? "")
        }
    }
}

struct NotebookPageView: View {
    let page: PageDescriptor
    let model: NotebookEditorModel
    @State private var drawing: PKDrawing?

    var body: some View {
        let pageSize = CGSize(width: page.size.width, height: page.size.height)
        ZStack {
            PageBackgroundView(background: page.background, pageSize: page.size)
            if let drawing {
                PageCanvasView(initialDrawing: drawing, pageSize: pageSize, toolPicker: model.toolPicker,
                               allowsFingerDrawing: model.allowsFingerDrawing) { updated in
                    model.drawingChanged(updated, pageID: page.id)
                }
            }
        }
        .aspectRatio(pageSize, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .shadow(color: .black.opacity(0.15), radius: 4, y: 2)
        .task(id: page.id) { drawing = await model.drawing(for: page.id) }
    }
}
#endif
