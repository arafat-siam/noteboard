import AuthenticationServices
import SwiftUI
import UIKit
import WebKit

struct WebShellView: UIViewControllerRepresentable {
    let appURL: URL

    func makeUIViewController(context: Context) -> ShellViewController {
        ShellViewController(appURL: appURL)
    }

    func updateUIViewController(_ controller: ShellViewController, context: Context) {}
}

/// Full-screen web view running Noteboard, plus the native pieces a web page can't do itself.
final class ShellViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate,
    ASWebAuthenticationPresentationContextProviding, UIScribbleInteractionDelegate {

    private let appURL: URL
    private var webView: WKWebView!
    private var pencil: PencilBridge?
    private var haptics: PencilHaptics?
    private var authSession: ASWebAuthenticationSession?
    private var downloads: [ObjectIdentifier: URL] = [:]

    init(appURL: URL) {
        self.appURL = appURL
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        // Lets the web app know it runs inside the shell (changes how Google sign-in finishes).
        let marker = WKUserScript(
            source: "window.noteboardShell = { version: 1 };",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(marker)

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsLinkPreview = false
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        // Scribble (Pencil handwriting-to-text) delays Pencil strokes; a notes canvas never wants it.
        webView.addInteraction(UIScribbleInteraction(delegate: self))

        let bridge = PencilBridge(webView: webView)
        bridge.install()
        pencil = bridge
        // Apple Pencil Pro buzz when a line or shape snaps.
        haptics = PencilHaptics.install(on: webView, config: config)

        self.webView = webView
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.load(URLRequest(url: appURL))
    }

    // MARK: Scribble

    func scribbleInteraction(_ interaction: UIScribbleInteraction, shouldBeginAt location: CGPoint) -> Bool {
        false
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .allow }
        if navigationAction.shouldPerformDownload {
            return .download
        }
        // Google blocks sign-in inside embedded web views, so use the system sign-in sheet.
        if url.host == "accounts.google.com" {
            startGoogleSignIn(url)
            return .cancel
        }
        // Links to other sites open in Safari.
        if navigationAction.navigationType == .linkActivated, let host = url.host, host != appURL.host {
            await UIApplication.shared.open(url)
            return .cancel
        }
        return .allow
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // MARK: Google sign-in

    private func startGoogleSignIn(_ url: URL) {
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: ShellConfig.callbackScheme) { [weak self] callbackURL, _ in
            Task { @MainActor in
                self?.finishGoogleSignIn(callbackURL)
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false // keep the Google login between sign-ins
        authSession = session
        if !session.start() {
            finishGoogleSignIn(nil)
        }
    }

    private func finishGoogleSignIn(_ callbackURL: URL?) {
        authSession = nil
        if let callbackURL,
           let query = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.percentEncodedQuery,
           let result = URL(string: appURL.absoluteString + "#" + query) {
            // Hand the result to the web app exactly as if Google had redirected straight to it.
            webView.load(URLRequest(url: result))
        } else {
            // Cancelled or failed: make sure the app is showing (a launch-time renewal may be pending).
            webView.load(URLRequest(url: appURL))
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            view.window ?? ASPresentationAnchor()
        }
    }

    // MARK: JavaScript alert / confirm (web views show nothing unless the app does it)

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in continuation.resume() })
            present(alert, animated: true)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async -> Bool {
        await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in continuation.resume(returning: false) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in continuation.resume(returning: true) })
            present(alert, animated: true)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            UIApplication.shared.open(url)
        }
        return nil
    }

    // MARK: Downloads (exports and backups) -> iPad share sheet

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String) async -> URL? {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(suggestedFilename)
        try? FileManager.default.removeItem(at: url)
        downloads[ObjectIdentifier(download)] = url
        return url
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        share.popoverPresentationController?.sourceView = view
        share.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: 60, width: 1, height: 1)
        present(share, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
    }
}
