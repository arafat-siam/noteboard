import UIKit
import WebKit

/// Receives Apple Pencil double-tap and squeeze (never delivered to web pages) and forwards
/// them to the web app via `window.noteboardPencil(gesture, {x, y})`.
@MainActor
final class PencilBridge: NSObject, UIPencilInteractionDelegate {
    private weak var webView: WKWebView?

    init(webView: WKWebView) {
        self.webView = webView
        super.init()
    }

    func install() {
        let interaction = UIPencilInteraction()
        interaction.delegate = self
        webView?.addInteraction(interaction)
    }

    // iPadOS 17.5+: includes where the Pencil is hovering, so the palette opens under the tip.
    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
        send("doubleTap", at: tap.hoverPose?.location)
    }

    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
        guard squeeze.phase == .ended else { return }
        send("squeeze", at: squeeze.hoverPose?.location)
    }

    // Older iPadOS versions (double-tap only).
    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        send("doubleTap", at: nil)
    }

    private func send(_ gesture: String, at point: CGPoint?) {
        guard let webView else { return }
        let payload = point.map { "{x: \(Double($0.x)), y: \(Double($0.y))}" } ?? "null"
        webView.evaluateJavaScript("window.noteboardPencil && window.noteboardPencil('\(gesture)', \(payload));", completionHandler: nil)
    }
}
