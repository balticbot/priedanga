// tiltas-peer: a macOS Tiltas node for testing phones over real Bluetooth.
//
//   swift run tiltas-peer [--offers offers.json] [--seconds N]
//
// Serves the alerts in offers.json (made by `npm run offers -w @priedanga/tiltas`)
// and prints every envelope it fetches from nearby phones. It does not verify
// what it receives and never relays it: it is a test seed and a probe.

import Foundation
import TiltasCore

struct OfferFile: Decodable {
  let envelope: String
  let priority: UInt8
  let expires: UInt32
}

var offersPath: String?
var seconds: Double?
var args = CommandLine.arguments.dropFirst().makeIterator()
while let a = args.next() {
  switch a {
  case "--offers": offersPath = args.next()
  case "--seconds": seconds = args.next().flatMap(Double.init)
  default:
    FileHandle.standardError.write("usage: tiltas-peer [--offers offers.json] [--seconds N]\n".data(using: .utf8)!)
    exit(2)
  }
}

let stateDir = FileManager.default.temporaryDirectory.appendingPathComponent("tiltas-peer-\(getpid())")
let engine = MeshEngine(stateDirectory: stateDir)
let stamp = ISO8601DateFormatter()
func say(_ s: String) { print("[\(stamp.string(from: Date()))] \(s)") }

engine.log = { say($0) }
var lastStatus: MeshStatus?
engine.onStatus = { s in
  guard s != lastStatus else { return }
  lastStatus = s
  say("bluetooth=\(s.bluetooth) running=\(s.running) served=\(s.served) peers=\(s.peersSeen) sessions=\(s.sessions) received=\(s.received)")
}
engine.onInbox = { _ in
  DispatchQueue.global().async {
    for env in engine.drainInbox() {
      let key = (try? Frames.envelopeBody(env)).map { Frames.meshKey($0).hex } ?? "?"
      say("received \(env.count) bytes, key \(key)\n\(env.hex)")
    }
  }
}

if let path = offersPath {
  do {
    let file = try JSONDecoder().decode([OfferFile].self, from: Data(contentsOf: URL(fileURLWithPath: path)))
    let offers = file.compactMap { o in Data(hex: o.envelope).map { (envelope: $0, priority: o.priority, expires: o.expires) } }
    engine.setOffers(offers)
    say("serving \(offers.count) alert(s) from \(path)")
  } catch {
    say("cannot read \(path): \(error)")
    exit(1)
  }
}

engine.start()
if let seconds {
  DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
    engine.stop()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(0) }
  }
}
RunLoop.main.run()
