import SwiftUI
import NoteboardLibrary
import NoteboardCanvas

/// Grid of folders and notebooks in the current folder, with drag-and-drop moving.
struct LibraryBrowserView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @Environment(\.supportsMultipleWindows) private var supportsMultipleWindows

    @State private var renamingItem: LibraryItem?
    @State private var newName = ""

    private let columns = [GridItem(.adaptive(minimum: 140, maximum: 200), spacing: 20)]

    var body: some View {
        @Bindable var model = model
        ScrollView {
            if model.items.isEmpty {
                ContentUnavailableView(
                    "Nothing Here Yet",
                    systemImage: "folder",
                    description: Text("Create a folder or notebook to get started."))
                    .padding(.top, 80)
            }
            LazyVGrid(columns: columns, spacing: 24) {
                ForEach(model.items, id: \.relativePath) { item in
                    tile(for: item)
                }
            }
            .padding()
        }
        .navigationTitle(model.currentFolderTitle)
        .toolbar {
            if let parent = model.parentFolder {
                ToolbarItem(placement: .navigation) {
                    Button("Back", systemImage: "chevron.backward") { model.show(folder: parent) }
                        // Drop on Back to move items up one level.
                        .dropDestination(for: String.self) { paths, _ in
                            Task { await model.move(paths, into: parent) }
                            return true
                        }
                }
            }
            ToolbarItemGroup(placement: .primaryAction) {
                Menu("Sort", systemImage: "arrow.up.arrow.down") {
                    Picker("Sort By", selection: $model.sort) {
                        ForEach(LibrarySort.allCases, id: \.self) { sort in
                            Text(sort.displayName).tag(sort)
                        }
                    }
                }
                Button("New Folder", systemImage: "folder.badge.plus") {
                    Task { await model.createFolder() }
                }
                .keyboardShortcut("n", modifiers: [.command, .shift])
                Button("New Notebook", systemImage: "square.and.pencil") {
                    Task { await model.createNotebook() }
                }
                .keyboardShortcut("n", modifiers: .command)
            }
        }
        .refreshable { await model.reload() }
        .alert("Rename", isPresented: Binding(
            get: { renamingItem != nil },
            set: { if !$0 { renamingItem = nil } })
        ) {
            TextField("Name", text: $newName)
            Button("Cancel", role: .cancel) {}
            Button("Rename") {
                if let item = renamingItem {
                    let name = newName
                    Task { await model.rename(item, to: name) }
                }
            }
        }
    }

    @ViewBuilder
    private func tile(for item: LibraryItem) -> some View {
        LibraryTile(item: item, isSelected: model.openNotebookPath == item.relativePath)
            .onTapGesture { model.open(item) }
            .draggable(item.relativePath)
            .dropDestination(for: String.self) { paths, _ in
                guard item.kind == .folder else { return false }
                let moving = paths.filter { $0 != item.relativePath }
                guard !moving.isEmpty else { return false }
                Task { await model.move(moving, into: item.relativePath) }
                return true
            }
            .contextMenu {
                Button("Rename", systemImage: "pencil") {
                    newName = item.title
                    renamingItem = item
                }
                if item.kind != .folder, supportsMultipleWindows {
                    Button("Open in New Window", systemImage: "macwindow.badge.plus") {
                        openWindow(id: "notebook", value: item.relativePath)
                    }
                }
                Divider()
                Button("Move to Trash", systemImage: "trash", role: .destructive) {
                    Task { await model.moveToTrash(item) }
                }
            }
    }
}

struct LibraryTile: View {
    let item: LibraryItem
    let isSelected: Bool

    var body: some View {
        VStack(spacing: 8) {
            Group {
                if item.kind == .folder {
                    Image(systemName: "folder.fill")
                        .resizable()
                        .scaledToFit()
                        .foregroundStyle(item.colorHex.flatMap(Color.init(hex:)) ?? .accentColor)
                        .padding(12)
                } else {
                    RoundedRectangle(cornerRadius: 8)
                        .fill((item.colorHex.flatMap(Color.init(hex:)) ?? .blue).gradient)
                        .overlay(alignment: .leading) {
                            Rectangle().fill(.black.opacity(0.18)).frame(width: 10)
                        }
                        .aspectRatio(0.75, contentMode: .fit)
                        .shadow(color: .black.opacity(0.2), radius: 3, y: 2)
                }
            }
            .frame(height: 150)

            Text(item.title)
                .font(.subheadline.weight(.medium))
                .lineLimit(2)
                .multilineTextAlignment(.center)
            Text(item.modifiedAt, format: .dateTime.day().month(.abbreviated).year())
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(8)
        .background(isSelected ? Color.accentColor.opacity(0.15) : .clear,
                    in: RoundedRectangle(cornerRadius: 12))
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .hoverEffect()
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(item.kind == .folder ? "Opens folder" : "Opens notebook")
    }
}

extension LibrarySort {
    var displayName: String {
        switch self {
        case .title: String(localized: "Name")
        case .dateCreated: String(localized: "Date Created")
        case .dateModified: String(localized: "Date Modified")
        case .lastOpened: String(localized: "Last Opened")
        }
    }
}
