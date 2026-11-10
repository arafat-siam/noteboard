import SwiftUI

@main
struct NoteboardShellApp: App {
    var body: some Scene {
        WindowGroup {
            WebShellView(appURL: ShellConfig.appURL)
                .ignoresSafeArea()
        }
    }
}

enum ShellConfig {
    /// The Noteboard web app. Notes sync through Google Drive, so the shell and Safari share them.
    static let appURL = URL(string: "https://arafat-siam.github.io/noteboard/")!
    /// Google sign-in finishes by sending the browser to this scheme (see src/sync/auth.ts).
    static let callbackScheme = "noteboardshell"
}
