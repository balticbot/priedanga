import Foundation
import XCTest

@testable import TiltasCore

/// Runs packages/tiltas/test-vectors/frames.json, the same vectors as the TypeScript implementation.
final class FrameVectorTests: XCTestCase {
  struct Entry: Decodable { let key: String; let priority: UInt8; let expires: UInt32 }
  struct InventoryVector: Decodable { let name: String; let hex: String; let ok: Bool; let entries: [Entry]? }
  struct SelectVector: Decodable { let name: String; let hex: String; let ok: Bool; let key: String?; let index: Int? }
  struct ChunkVector: Decodable { let name: String; let hex: String; let ok: Bool; let index: UInt8?; let total: UInt8?; let payload: String? }
  struct EnvelopeVector: Decodable { let name: String; let hex: String; let key: String; let ok: Bool; let body: String?; let chunks: [String]? }
  struct File: Decodable {
    let inventory: [InventoryVector]
    let select: [SelectVector]
    let chunk: [ChunkVector]
    let envelope: [EnvelopeVector]
  }

  static let vectors: File = {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // TiltasCoreTests
      .appendingPathComponent("../../../../../../../packages/tiltas/test-vectors/frames.json")
      .standardizedFileURL
    return try! JSONDecoder().decode(File.self, from: Data(contentsOf: url))
  }()

  private func bytes(_ hex: String) -> Data { Data(hex: hex)! }

  func testInventory() throws {
    XCTAssertGreaterThan(Self.vectors.inventory.count, 5)
    for v in Self.vectors.inventory {
      if !v.ok {
        XCTAssertThrowsError(try Frames.decodeInventory(bytes(v.hex)), v.name)
        continue
      }
      let entries = try Frames.decodeInventory(bytes(v.hex))
      XCTAssertEqual(entries.map { $0.key.hex }, v.entries!.map(\.key), v.name)
      XCTAssertEqual(entries.map(\.priority), v.entries!.map(\.priority), v.name)
      XCTAssertEqual(entries.map(\.expires), v.entries!.map(\.expires), v.name)
      XCTAssertEqual(try Frames.encodeInventory(entries.reversed()).hex, v.hex, v.name)
    }
  }

  func testSelect() throws {
    for v in Self.vectors.select {
      if !v.ok {
        XCTAssertThrowsError(try Frames.decodeSelect(bytes(v.hex)), v.name)
        continue
      }
      let s = try Frames.decodeSelect(bytes(v.hex))
      XCTAssertEqual(s.key.hex, v.key, v.name)
      XCTAssertEqual(s.index, v.index, v.name)
      XCTAssertEqual(try Frames.encodeSelect(key: s.key, index: s.index).hex, v.hex, v.name)
    }
  }

  func testChunk() throws {
    for v in Self.vectors.chunk {
      if !v.ok {
        XCTAssertThrowsError(try Frames.decodeChunk(bytes(v.hex)), v.name)
        continue
      }
      let c = try Frames.decodeChunk(bytes(v.hex))
      XCTAssertEqual(c.index, v.index, v.name)
      XCTAssertEqual(c.total, v.total, v.name)
      XCTAssertEqual(c.payload.hex, v.payload, v.name)
    }
  }

  func testEnvelope() throws {
    for v in Self.vectors.envelope {
      let env = bytes(v.hex)
      if !v.ok {
        XCTAssertThrowsError(try Frames.checkEnvelope(env, key: bytes(v.key)), v.name)
        continue
      }
      XCTAssertEqual(try Frames.checkEnvelope(env, key: bytes(v.key)).hex, v.body, v.name)
      guard let chunks = v.chunks else { continue }
      XCTAssertEqual(chunks.indices.map { Frames.encodeChunk(env, index: $0).hex }, chunks, v.name)
      let decoded = try chunks.map { try Frames.decodeChunk(bytes($0)) }
      XCTAssertEqual(try Frames.reassemble(decoded).hex, v.hex, v.name)
      XCTAssertEqual(Frames.encodeChunk(env, index: chunks.count), Frames.notAvailable, v.name)
    }
  }
}
