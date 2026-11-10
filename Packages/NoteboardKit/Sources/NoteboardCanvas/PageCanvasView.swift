#if canImport(UIKit) && canImport(PencilKit)
import SwiftUI
import PencilKit

/// A `PKCanvasView` locked to a fixed page size and scaled to fit its width.
/// Strokes are stored in page coordinates, so a page looks identical on every iPad
/// size and orientation.
final class FixedPageCanvasView: PKCanvasView {
    var pageSize: CGSize = .zero {
        didSet { if pageSize != oldValue { setNeedsLayout() } }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard pageSize.width > 0, bounds.width > 0 else { return }
        let scale = bounds.width / pageSize.width
        if abs(minimumZoomScale - scale) > 0.0001 || abs(zoomScale - scale) > 0.0001 {
            minimumZoomScale = scale
            maximumZoomScale = scale
            zoomScale = scale
        }
        let size = CGSize(width: pageSize.width * scale, height: pageSize.height * scale)
        if contentSize != size { contentSize = size }
        if contentOffset != .zero { contentOffset = .zero }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        // Becoming first responder is what makes the shared tool picker appear.
        if window != nil { becomeFirstResponder() }
    }
}

/// Ink surface for one page. Only pages near the viewport host one (the editor uses a
/// `LazyVStack`), so memory stays flat on long notebooks.
public struct PageCanvasView: UIViewRepresentable {
    let initialDrawing: PKDrawing
    let pageSize: CGSize
    let toolPicker: PKToolPicker
    let allowsFingerDrawing: Bool
    let onDrawingChanged: (PKDrawing) -> Void

    public init(initialDrawing: PKDrawing, pageSize: CGSize, toolPicker: PKToolPicker,
                allowsFingerDrawing: Bool, onDrawingChanged: @escaping (PKDrawing) -> Void) {
        self.initialDrawing = initialDrawing
        self.pageSize = pageSize
        self.toolPicker = toolPicker
        self.allowsFingerDrawing = allowsFingerDrawing
        self.onDrawingChanged = onDrawingChanged
    }

    public func makeUIView(context: Context) -> PKCanvasView {
        let canvas = FixedPageCanvasView()
        canvas.pageSize = pageSize
        canvas.drawing = initialDrawing
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        // The editor's ScrollView scrolls pages; the canvas itself never scrolls.
        canvas.isScrollEnabled = false
        canvas.bouncesZoom = false
        canvas.showsVerticalScrollIndicator = false
        canvas.showsHorizontalScrollIndicator = false
        canvas.drawingPolicy = allowsFingerDrawing ? .anyInput : .pencilOnly
        canvas.delegate = context.coordinator
        toolPicker.addObserver(canvas)
        toolPicker.setVisible(true, forFirstResponder: canvas)
        return canvas
    }

    public func updateUIView(_ canvas: PKCanvasView, context: Context) {
        context.coordinator.onDrawingChanged = onDrawingChanged
        (canvas as? FixedPageCanvasView)?.pageSize = pageSize
        canvas.drawingPolicy = allowsFingerDrawing ? .anyInput : .pencilOnly
    }

    public static func dismantleUIView(_ canvas: PKCanvasView, coordinator: Coordinator) {
        coordinator.toolPicker.setVisible(false, forFirstResponder: canvas)
        coordinator.toolPicker.removeObserver(canvas)
    }

    public func makeCoordinator() -> Coordinator {
        Coordinator(toolPicker: toolPicker, onDrawingChanged: onDrawingChanged)
    }

    @MainActor
    public final class Coordinator: NSObject, PKCanvasViewDelegate {
        let toolPicker: PKToolPicker
        var onDrawingChanged: (PKDrawing) -> Void

        init(toolPicker: PKToolPicker, onDrawingChanged: @escaping (PKDrawing) -> Void) {
            self.toolPicker = toolPicker
            self.onDrawingChanged = onDrawingChanged
        }

        public func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            onDrawingChanged(canvasView.drawing)
        }

        public func canvasViewDidBeginUsingTool(_ canvasView: PKCanvasView) {
            if !canvasView.isFirstResponder { canvasView.becomeFirstResponder() }
        }
    }
}
#endif
