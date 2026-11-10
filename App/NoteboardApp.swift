import SwiftUI
import NoteboardCore
import NoteboardLibrary

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
            if let relativePath {
                NotebookPlaceholderView(relativePath: relativePath)
                    .environment(model)
            }
        }
    }
}
