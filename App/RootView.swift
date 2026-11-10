import SwiftUI
import NoteboardCanvas

struct RootView: View {
    @Environment(AppModel.self) private var model
    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    var body: some View {
        @Bindable var model = model
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SidebarView(selection: $model.selection)
        } content: {
            ContentColumn()
        } detail: {
            if let path = model.openNotebookPath, let url = model.notebookURL(for: path) {
                NotebookEditorView(packageURL: url)
                    .id(path)
            } else {
                ContentUnavailableView(
                    "No Notebook Selected",
                    systemImage: "book.closed",
                    description: Text("Select a notebook or create a new one."))
            }
        }
        .alert("Something Went Wrong", isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.errorMessage ?? "")
        }
    }
}

struct SidebarView: View {
    @Environment(AppModel.self) private var model
    @Binding var selection: AppModel.SidebarSelection?

    var body: some View {
        List(selection: $selection) {
            Section {
                Label("Library", systemImage: "books.vertical")
                    .tag(AppModel.SidebarSelection.library)
                Label("Favorites", systemImage: "star")
                    .tag(AppModel.SidebarSelection.favorites)
                Label("Recents", systemImage: "clock")
                    .tag(AppModel.SidebarSelection.recents)
            }
            if !model.smartFolders.isEmpty {
                Section("Smart Folders") {
                    ForEach(model.smartFolders) { folder in
                        Label(folder.name, systemImage: folder.symbolName)
                            .tag(AppModel.SidebarSelection.smartFolder(folder.id))
                    }
                }
            }
            if !model.tags.isEmpty {
                Section("Tags") {
                    ForEach(model.tags, id: \.self) { tag in
                        Label(tag, systemImage: "tag")
                            .tag(AppModel.SidebarSelection.tag(tag))
                    }
                }
            }
            Section {
                Label("Trash", systemImage: "trash")
                    .badge(model.trashEntries.count)
                    .tag(AppModel.SidebarSelection.trash)
            }
        }
        .navigationTitle("Noteboard")
    }
}

struct ContentColumn: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        switch model.selection {
        case .library, nil:
            LibraryBrowserView()
        case .trash:
            TrashView()
        case .favorites:
            ComingSoonView(title: "Favorites", systemImage: "star")
        case .recents:
            ComingSoonView(title: "Recents", systemImage: "clock")
        case .tag(let tag):
            ComingSoonView(title: tag, systemImage: "tag")
        case .smartFolder:
            ComingSoonView(title: "Smart Folder", systemImage: "sparkle.magnifyingglass")
        }
    }
}

struct ComingSoonView: View {
    let title: String
    let systemImage: String

    var body: some View {
        ContentUnavailableView(title, systemImage: systemImage,
                               description: Text("Coming in Milestone 1."))
            .navigationTitle(title)
    }
}

#Preview {
    RootView().environment(AppModel())
}
