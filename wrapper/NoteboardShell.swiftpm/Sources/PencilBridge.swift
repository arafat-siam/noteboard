import UIKit
import UIKit.UIGestureRecognizerSubclass
import WebKit

/// Receives Apple Pencil double-tap, squeeze and (Pencil Pro) barrel roll — none of which reach
/// web pages — and forwards them to the web app:
///   window.noteboardPencil(gesture, {x, y})   double-tap / squeeze
///   window.noteboardPencilRoll(radians)       barrel roll, while touching or hovering
@MainActor
final class PencilBridge: NSObject, UIPencilInteractionDelegate, UIGestureRecognizerDelegate {
    private weak var webView: WKWebView?
    private var lastRoll: CGFloat = .nan
    private var lastRollSent: CFTimeInterval = 0

    init(webView: WKWebView) {
        self.webView = webView
        super.init()
    }

    func install() {
        guard let webView else { return }
        let interaction = UIPencilInteraction()
        interaction.delegate = self
        webView.addInteraction(interaction)

        if #available(iOS 17.5, *) {
            // Barrel roll while hovering.
            let hover = UIHoverGestureRecognizer(target: self, action: #selector(hovered(_:)))
            hover.delegate = self
            webView.addGestureRecognizer(hover)
            // Barrel roll while touching: watches Pencil touches without ever claiming them.
            let roll = RollObserver(target: nil, action: nil)
            roll.delegate = self
            roll.onRoll = { [weak self] angle in self?.sendRoll(angle) }
            webView.addGestureRecognizer(roll)
        }
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

    @available(iOS 17.5, *)
    @objc private func hovered(_ recognizer: UIHoverGestureRecognizer) {
        guard recognizer.state == .began || recognizer.state == .changed else { return }
        sendRoll(recognizer.rollAngle)
    }

    /// Only sends when the roll actually changes (and at most ~60 times a second).
    private func sendRoll(_ angle: CGFloat) {
        let now = CACurrentMediaTime()
        if !lastRoll.isNaN, abs(angle - lastRoll) < 0.02 { return }
        if now - lastRollSent < 0.016 { return }
        lastRoll = angle
        lastRollSent = now
        webView?.evaluateJavaScript("window.noteboardPencilRoll && window.noteboardPencilRoll(\(Double(angle)));", completionHandler: nil)
    }

    private func send(_ gesture: String, at point: CGPoint?) {
        guard let webView else { return }
        let payload = point.map { "{x: \(Double($0.x)), y: \(Double($0.y))}" } ?? "null"
        webView.evaluateJavaScript("window.noteboardPencil && window.noteboardPencil('\(gesture)', \(payload));", completionHandler: nil)
    }

    // Never get in the way of the web view's own gestures.
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        true
    }
}

/// Reads `rollAngle` from Apple Pencil touches. It never recognizes, never delays and never
/// cancels touches, so the web page receives every touch exactly as before.
@available(iOS 17.5, *)
final class RollObserver: UIGestureRecognizer {
    var onRoll: ((CGFloat) -> Void)?

    override init(target: Any?, action: Selector?) {
        super.init(target: target, action: action)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
    }

    private func report(_ touches: Set<UITouch>) {
        for touch in touches where touch.type == .pencil {
            onRoll?(touch.rollAngle)
        }
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        report(touches)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        report(touches)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        state = .failed
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        state = .failed
    }
}
