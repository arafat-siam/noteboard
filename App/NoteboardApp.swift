import SwiftUI
import NoteboardCanvas

@main
struct NoteboardApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .task { await model.bootstrap() }
        }

        // Opens a notebook in its own window (Stage Manager / Split View side-by-side).
        WindowGroup(id: "notebook", for: String.self) { $relativePath in
            NavigationStack {
                if let relativePath, let url = model.notebookURL(for: relativePath) {
                    NotebookEditorView(packageURL: url)
                } else {
                    ContentUnavailableView("Notebook Unavailable", systemImage: "book.closed")
                }
            }
            .environment(model)
            .task { await model.bootstrap() }
        }
    }
}
