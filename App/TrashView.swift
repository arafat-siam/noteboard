import SwiftUI
import NoteboardLibrary

struct TrashView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List(model.trashEntries) { entry in
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.title)
                    Text("From \(entry.originalFolder.isEmpty ? String(localized: "Library") : entry.originalFolder) · \(entry.trashedAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Restore") {
                    Task { await model.restore(entry) }
                }
                .buttonStyle(.bordered)
            }
        }
        .overlay {
            if model.trashEntries.isEmpty {
                ContentUnavailableView("Trash Is Empty", systemImage: "trash",
                                       description: Text("Items in the trash are deleted after 30 days."))
            }
        }
        .navigationTitle("Trash")
    }
}
