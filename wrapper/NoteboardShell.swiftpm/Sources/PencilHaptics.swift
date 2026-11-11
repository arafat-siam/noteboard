import UIKit
import WebKit

/// Plays Apple Pencil Pro haptics when the web app asks (snapping a line, a shape snapping).
/// The web app calls `window.webkit.messageHandlers.noteboardHaptic.postMessage({kind, x, y})`.
/// iPadOS only buzzes the Pencil while it is touching the screen, which is exactly when
/// snapping happens.
@MainActor
final class PencilHaptics: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    private var generator: AnyObject?

    init(webView: WKWebView) {
        self.webView = webView
        super.init()
    }

    /// Registers the message handler through a weak proxy (WebKit keeps handlers alive).
    static func install(on webView: WKWebView, config: WKWebViewConfiguration) -> PencilHaptics {
        let haptics = PencilHaptics(webView: webView)
        config.userContentController.add(WeakScriptHandler(haptics), name: "noteboardHaptic")
        return haptics
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard #available(iOS 17.5, *), let webView,
              let body = message.body as? [String: Any],
              let kind = body["kind"] as? String,
              let x = body["x"] as? Double, let y = body["y"] as? Double else { return }
        let generator: UICanvasFeedbackGenerator
        if let existing = self.generator as? UICanvasFeedbackGenerator {
            generator = existing
        } else {
            generator = UICanvasFeedbackGenerator(view: webView)
            self.generator = generator
        }
        let point = CGPoint(x: x, y: y)
        if kind == "pathCompleted" {
            generator.pathCompleted(at: point)
        } else {
            generator.alignmentOccurred(at: point)
        }
    }
}

private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: (NSObject & WKScriptMessageHandler)?

    init(_ target: NSObject & WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
