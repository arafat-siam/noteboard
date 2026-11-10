// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "NoteboardKit",
    defaultLocalization: "en",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "NoteboardCore", targets: ["NoteboardCore"]),
        .library(name: "NoteboardLibrary", targets: ["NoteboardLibrary"]),
        .library(name: "NoteboardCanvas", targets: ["NoteboardCanvas"]),
        .library(name: "NoteboardPDF", targets: ["NoteboardPDF"]),
        .library(name: "NoteboardSync", targets: ["NoteboardSync"]),
    ],
    targets: [
        .target(name: "NoteboardCore"),
        .target(name: "NoteboardLibrary", dependencies: ["NoteboardCore"]),
        .target(name: "NoteboardCanvas", dependencies: ["NoteboardCore"]),
        .target(name: "NoteboardPDF", dependencies: ["NoteboardCore"]),
        .target(name: "NoteboardSync", dependencies: ["NoteboardCore"]),

        .testTarget(name: "NoteboardCoreTests", dependencies: ["NoteboardCore"]),
        .testTarget(name: "NoteboardLibraryTests", dependencies: ["NoteboardLibrary"]),
    ]
)
