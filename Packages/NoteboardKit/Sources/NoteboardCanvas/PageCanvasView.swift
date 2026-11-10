#if canImport(UIKit) && canImport(PencilKit)
import SwiftUI
import PencilKit
import NoteboardCore

/// A single page's ink surface. Only pages near the viewport should host one of these
/// (see canvas virtualization in docs/ARCHITECTURE.md).
public struct PageCanvasView: UIViewRepresentable {
    @Binding var drawing: PKDrawing
    var isToolPickerVisible: Bool
    var onDrawingChanged: (PKDrawing) -> Void

    public init(drawing: Binding<PKDrawing>, isToolPickerVisible: Bool = true,
                onDrawingChanged: @escaping (PKDrawing) -> Void = { _ in }) {
        self._drawing = drawing
        self.isToolPickerVisible = isToolPickerVisible
        self.onDrawingChanged = onDrawingChanged
    }

    public func makeUIView(context: Context) -> PKCanvasView {
        let canvas = PKCanvasView()
        canvas.drawing = drawing
        canvas.drawingPolicy = .pencilOnly          // finger scrolls/zooms, Pencil draws
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.delegate = context.coordinator
        context.coordinator.toolPicker.addObserver(canvas)
        return canvas
    }

    public func updateUIView(_ canvas: PKCanvasView, context: Context) {
        context.coordinator.parent = self
        if canvas.drawing != drawing { canvas.drawing = drawing }
        context.coordinator.toolPicker.setVisible(isToolPickerVisible, forFirstResponder: canvas)
        if isToolPickerVisible { canvas.becomeFirstResponder() }
    }

    public func makeCoordinator() -> Coordinator { Coordinator(self) }

    @MainActor
    public final class Coordinator: NSObject, PKCanvasViewDelegate {
        var parent: PageCanvasView
        let toolPicker = PKToolPicker()

        init(_ parent: PageCanvasView) { self.parent = parent }

        public func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            parent.drawing = canvasView.drawing
            parent.onDrawingChanged(canvasView.drawing)
        }
    }
}
#endif
