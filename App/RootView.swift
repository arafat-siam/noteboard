import SwiftUI
import NoteboardLibrary

struct RootView: View {
    @Environment(AppModel.self) private var model
    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    var body: some View {
        @Bindable var model = model
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SidebarView(selection: $model.selection)
        } content: {
            LibraryContentView(selection: model.selection)
        } detail: {
            ContentUnavailableView(
                String(localized: "No Notebook Selected"),
                systemImage: "book.closed",
                description: Text("Select a notebook or create a new one."))
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
                    .tag(AppModel.SidebarSelection.library(folder: ""))
                Label("Favorites", systemImage: "star")
                    .tag(AppModel.SidebarSelection.favorites)
                Label("Recents", systemImage: "clock")
                    .tag(AppModel.SidebarSelection.recents)
            }
            Section("Smart Folders") {
                ForEach(model.smartFolders) { folder in
                    Label(folder.name, systemImage: folder.symbolName)
                        .tag(AppModel.SidebarSelection.smartFolder(folder.id))
                }
            }
            Section("Tags") {
                ForEach(model.tags, id: \.self) { tag in
                    Label(tag, systemImage: "tag")
                        .tag(AppModel.SidebarSelection.tag(tag))
                }
            }
            Section {
                Label("Trash", systemImage: "trash")
                    .tag(AppModel.SidebarSelection.trash)
            }
        }
        .navigationTitle("Noteboard")
    }
}

struct LibraryContentView: View {
    let selection: AppModel.SidebarSelection?

    var body: some View {
        ContentUnavailableView(
            String(localized: "Nothing Here Yet"),
            systemImage: "folder",
            description: Text("Create a folder or notebook to get started."))
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button("New Folder", systemImage: "folder.badge.plus") {}
                    .keyboardShortcut("n", modifiers: [.command, .shift])
                Button("New Notebook", systemImage: "square.and.pencil") {}
                    .keyboardShortcut("n", modifiers: .command)
            }
        }
    }
}

struct NotebookPlaceholderView: View {
    let relativePath: String

    var body: some View {
        Text(relativePath)
            .navigationTitle((relativePath as NSString).lastPathComponent)
    }
}

#Preview {
    RootView().environment(AppModel())
}
