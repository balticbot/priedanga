import ExpoModulesCore

struct OfferRecord: Record {
  @Field var envelope: String = ""
  @Field var priority: Int = 0
  @Field var expires: Double = 0
}

/// Thin bridge to MeshEngine. Envelopes and keys cross as hex strings.
public class TiltasModule: Module {
  private lazy var engine: MeshEngine = {
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("tiltas", isDirectory: true)
    let e = MeshEngine(stateDirectory: dir)
    e.onStatus = { [weak self] s in self?.sendEvent("onStatus", Self.dictionary(s)) }
    e.onInbox = { [weak self] n in self?.sendEvent("onInbox", ["count": n]) }
    return e
  }()

  static func dictionary(_ s: MeshStatus) -> [String: Any] {
    var d: [String: Any] = [
      "bluetooth": s.bluetooth, "running": s.running, "served": s.served, "inbox": s.inbox,
      "peersSeen": s.peersSeen, "sessions": s.sessions, "received": s.received,
    ]
    if let t = s.lastSync { d["lastSync"] = t.timeIntervalSince1970 * 1000 }
    return d
  }

  public func definition() -> ModuleDefinition {
    Name("Tiltas")
    Events("onStatus", "onInbox")

    Function("getStatus") { Self.dictionary(self.engine.status()) }
    // title/text are for Android's foreground-service notification; iOS has none.
    Function("start") { (_: String, _: String) in self.engine.start() }
    Function("stop") { self.engine.stop() }

    Function("setOffers") { (offers: [OfferRecord]) in
      self.engine.setOffers(offers.compactMap { o in
        guard let env = Data(hex: o.envelope), (0...3).contains(o.priority), o.expires >= 0, o.expires <= Double(UInt32.max) else { return nil }
        return (envelope: env, priority: UInt8(o.priority), expires: UInt32(o.expires))
      })
    }

    Function("drainInbox") { () -> [String] in self.engine.drainInbox().map(\.hex) }

    Function("markRejected") { (keys: [String]) in
      self.engine.markRejected(keys.compactMap { Data(hex: $0) })
    }
  }
}
