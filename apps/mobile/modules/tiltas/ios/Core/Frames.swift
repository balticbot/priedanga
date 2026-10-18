// Tiltas v1 wire frames (packages/tiltas/SPEC.md §2). Mirrors
// packages/tiltas/src/protocol.ts and must pass test-vectors/frames.json.

import CryptoKit
import Foundation

public enum Tiltas {
  public static let version: UInt8 = 1
  public static let serviceUUID = "9E48E5B5-A636-4FC6-8312-05C46E541BEC"
  public static let inventoryUUID = "A247668E-46A8-48A7-A7F7-9C774346DC20"
  public static let selectUUID = "E6F3F542-B066-4CB9-B85D-01C4FA01E412"
  public static let chunkUUID = "114CED89-DD83-444E-AF0B-C382940F1D4C"

  public static let keyBytes = 8
  public static let maxInventory = 32
  public static let maxEnvelope = 1024
  public static let chunkPayload = 480
  public static let maxChunks = 3
  public static let maxPriority: UInt8 = 3
  static let entryBytes = keyBytes + 1 + 4
}

public struct FrameError: Error, CustomStringConvertible {
  public let description: String
  init(_ description: String) { self.description = description }
}

public struct InventoryEntry: Equatable {
  public var key: Data
  public var priority: UInt8
  public var expires: UInt32

  public init(key: Data, priority: UInt8, expires: UInt32) {
    self.key = key
    self.priority = priority
    self.expires = expires
  }

  /// Priority desc, expires desc, then key ascending (SPEC §2.1).
  public static func moreUrgent(_ a: InventoryEntry, _ b: InventoryEntry) -> Bool {
    if a.priority != b.priority { return a.priority > b.priority }
    if a.expires != b.expires { return a.expires > b.expires }
    return a.key.lexicographicallyPrecedes(b.key)
  }
}

public struct Chunk: Equatable {
  public var index: UInt8
  /// 0 = not available.
  public var total: UInt8
  public var payload: Data
}

public enum Frames {
  public static let notAvailable = Data([Tiltas.version, 0, 0])

  /// SHA-256 of the signed body, first 8 bytes (SPEC §1.2).
  public static func meshKey(_ body: Data) -> Data {
    Data(SHA256.hash(data: body).prefix(Tiltas.keyBytes))
  }

  public static func encodeInventory(_ entries: [InventoryEntry]) throws -> Data {
    guard entries.count <= Tiltas.maxInventory else { throw FrameError("too many entries") }
    var out = Data([Tiltas.version, UInt8(entries.count)])
    var seen = Set<Data>()
    for e in entries.sorted(by: InventoryEntry.moreUrgent) {
      guard e.key.count == Tiltas.keyBytes else { throw FrameError("bad key length") }
      guard e.priority <= Tiltas.maxPriority else { throw FrameError("bad priority") }
      guard seen.insert(e.key).inserted else { throw FrameError("duplicate key") }
      out.append(e.key)
      out.append(e.priority)
      out.append(contentsOf: withUnsafeBytes(of: e.expires.bigEndian, Array.init))
    }
    return out
  }

  public static func decodeInventory(_ frame: Data) throws -> [InventoryEntry] {
    let b = [UInt8](frame)
    guard b.count >= 2, b[0] == Tiltas.version else { throw FrameError("bad version") }
    let count = Int(b[1])
    guard count <= Tiltas.maxInventory else { throw FrameError("too many entries") }
    guard b.count == 2 + Tiltas.entryBytes * count else { throw FrameError("bad length") }
    var seen = Set<Data>()
    var entries: [InventoryEntry] = []
    for i in 0..<count {
      let at = 2 + i * Tiltas.entryBytes
      let key = Data(b[at..<at + Tiltas.keyBytes])
      let priority = b[at + Tiltas.keyBytes]
      guard priority <= Tiltas.maxPriority else { throw FrameError("bad priority") }
      guard seen.insert(key).inserted else { throw FrameError("duplicate key") }
      let e = at + Tiltas.keyBytes + 1
      let expires = UInt32(b[e]) << 24 | UInt32(b[e + 1]) << 16 | UInt32(b[e + 2]) << 8 | UInt32(b[e + 3])
      entries.append(InventoryEntry(key: key, priority: priority, expires: expires))
    }
    return entries
  }

  public static func encodeSelect(key: Data, index: Int) throws -> Data {
    guard key.count == Tiltas.keyBytes else { throw FrameError("bad key length") }
    guard index >= 0, index < Tiltas.maxChunks else { throw FrameError("bad index") }
    var out = Data([Tiltas.version])
    out.append(key)
    out.append(UInt8(index))
    return out
  }

  public static func decodeSelect(_ frame: Data) throws -> (key: Data, index: Int) {
    let b = [UInt8](frame)
    guard b.count == 2 + Tiltas.keyBytes, b[0] == Tiltas.version else { throw FrameError("bad select") }
    let index = Int(b[1 + Tiltas.keyBytes])
    guard index < Tiltas.maxChunks else { throw FrameError("bad index") }
    return (Data(b[1...Tiltas.keyBytes]), index)
  }

  public static func chunkCount(_ length: Int) -> Int {
    (length + Tiltas.chunkPayload - 1) / Tiltas.chunkPayload
  }

  /// CHUNK frame `index` of `envelope`, or `notAvailable` if out of range.
  public static func encodeChunk(_ envelope: Data, index: Int) -> Data {
    let b = [UInt8](envelope)
    guard !b.isEmpty, b.count <= Tiltas.maxEnvelope else { return notAvailable }
    let total = chunkCount(b.count)
    guard index >= 0, index < total else { return notAvailable }
    var out = Data([Tiltas.version, UInt8(index), UInt8(total)])
    out.append(contentsOf: b[index * Tiltas.chunkPayload..<min(b.count, (index + 1) * Tiltas.chunkPayload)])
    return out
  }

  public static func decodeChunk(_ frame: Data) throws -> Chunk {
    let b = [UInt8](frame)
    guard b.count >= 3, b[0] == Tiltas.version else { throw FrameError("bad chunk") }
    let index = b[1], total = b[2]
    let payload = Data(b[3...])
    if total == 0 {
      guard index == 0, payload.isEmpty else { throw FrameError("bad not-available frame") }
      return Chunk(index: 0, total: 0, payload: payload)
    }
    guard Int(total) <= Tiltas.maxChunks, index < total else { throw FrameError("bad index") }
    let last = index == total - 1
    let ok = last ? (1...Tiltas.chunkPayload).contains(payload.count) : payload.count == Tiltas.chunkPayload
    guard ok else { throw FrameError("bad payload length") }
    return Chunk(index: index, total: total, payload: payload)
  }

  public static func reassemble(_ chunks: [Chunk]) throws -> Data {
    guard let total = chunks.first?.total, total > 0, chunks.count == Int(total) else { throw FrameError("incomplete") }
    var out = Data()
    for (i, c) in chunks.enumerated() {
      guard Int(c.index) == i, c.total == total else { throw FrameError("chunk out of order") }
      out.append(c.payload)
    }
    return out
  }

  // MARK: Envelope shape check (SPEC §2.4)

  private static func head(_ b: [UInt8], _ at: Int, major: UInt8) throws -> (value: Int, next: Int) {
    guard at < b.count, b[at] >> 5 == major else { throw FrameError("unexpected item") }
    let info = b[at] & 0x1f
    if info < 24 { return (Int(info), at + 1) }
    let width = info == 24 ? 1 : info == 25 ? 2 : info == 26 ? 4 : 0
    guard width > 0, at + 1 + width <= b.count else { throw FrameError("unsupported length") }
    var value = 0
    for i in 0..<width { value = value << 8 | Int(b[at + 1 + i]) }
    let min = width == 1 ? 24 : width == 2 ? 0x100 : 0x10000
    guard value >= min else { throw FrameError("non-shortest length") }
    return (value, at + 1 + width)
  }

  /// The signed body, if `envelope` has the alert-envelope shape `[uint, bstr, bstr(64), uint]`.
  public static func envelopeBody(_ envelope: Data) throws -> Data {
    let b = [UInt8](envelope)
    guard b.count <= Tiltas.maxEnvelope else { throw FrameError("too large") }
    guard b.first == 0x84 else { throw FrameError("not a 4-item array") }
    var at = try head(b, 1, major: 0).next
    let body = try head(b, at, major: 2)
    guard body.next + body.value <= b.count else { throw FrameError("truncated body") }
    let bodyBytes = Data(b[body.next..<body.next + body.value])
    at = body.next + body.value
    let sig = try head(b, at, major: 2)
    guard sig.value == 64, sig.next + 64 <= b.count else { throw FrameError("bad signature length") }
    at = try head(b, sig.next + 64, major: 0).next
    guard at == b.count else { throw FrameError("trailing bytes") }
    return bodyBytes
  }

  /// `envelopeBody` plus the content-address check against the requested key.
  public static func checkEnvelope(_ envelope: Data, key: Data) throws -> Data {
    let body = try envelopeBody(envelope)
    guard meshKey(body) == key else { throw FrameError("key mismatch") }
    return body
  }
}

public extension Data {
  init?(hex: String) {
    guard hex.count % 2 == 0 else { return nil }
    var out = Data(capacity: hex.count / 2)
    var it = hex.makeIterator()
    while let a = it.next(), let b = it.next() {
      guard let v = UInt8(String([a, b]), radix: 16) else { return nil }
      out.append(v)
    }
    self = out
  }

  var hex: String { map { String(format: "%02x", $0) }.joined() }
}
