// swift-tools-version: 5.9

// Noteboard Shell — a tiny native app (built and run with Swift Playgrounds on the iPad) that
// shows the Noteboard web app and passes Apple Pencil double-tap and squeeze into it.
// Web pages can't receive those gestures on their own.

import PackageDescription
import AppleProductTypes

let package = Package(
    name: "Noteboard",
    platforms: [
        .iOS("17.0")
    ],
    products: [
        .iOSApplication(
            name: "Noteboard",
            targets: ["AppModule"],
            bundleIdentifier: "io.github.arafatsiam.noteboard.shell",
            displayVersion: "1.0",
            bundleVersion: "1",
            appIcon: .asset("AppIcon"),
            accentColor: .presetColor(.blue),
            supportedDeviceFamilies: [
                .pad
            ],
            supportedInterfaceOrientations: [
                .portrait,
                .landscapeRight,
                .landscapeLeft,
                .portraitUpsideDown(.when(deviceFamilies: [.pad]))
            ]
        )
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            path: "Sources"
        )
    ]
)
