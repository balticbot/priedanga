// swift-tools-version:5.9
// Swift side of Tiltas, buildable without Xcode/Expo: `swift test` runs the
// shared frame vectors; `swift run tiltas-peer` is a macOS mesh peer for
// testing a phone over real Bluetooth. The Expo pod compiles Core/ plus
// TiltasModule.swift (see Tiltas.podspec).
import PackageDescription

let package = Package(
  name: "Tiltas",
  platforms: [.macOS(.v13), .iOS("16.4")],
  products: [.library(name: "TiltasCore", targets: ["TiltasCore"])],
  targets: [
    .target(name: "TiltasCore", path: "Core"),
    .executableTarget(
      name: "tiltas-peer",
      dependencies: ["TiltasCore"],
      path: "Peer",
      exclude: ["Info.plist"],
      linkerSettings: [
        // CoreBluetooth needs a usage description, even in a command-line tool.
        .unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", "Peer/Info.plist"])
      ]
    ),
    .testTarget(name: "TiltasCoreTests", dependencies: ["TiltasCore"], path: "Tests/TiltasCoreTests"),
  ]
)
