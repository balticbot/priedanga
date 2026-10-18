import CryptoKit
import Foundation

/// Strict RFC 8032 Ed25519 verification, matching the Priedanga JS reference
/// (`@noble/curves` with `zip215: false`) on every vector in
/// `packages/alert-format/test-vectors/ed25519-strict.json`.
///
/// CryptoKit does the curve arithmetic. The encoding rules it may be lenient
/// about are enforced here first, on bytes only:
///   - S must be canonical (S < L)
///   - R and A must be canonical encodings (y < p; not x = 0 with the sign bit)
///   - A must not be a small-order point
///
/// Pure Swift + CryptoKit, no Expo dependency: the Tiltas mesh can reuse it
/// without the JS runtime. Never throws; anything malformed is `false`.
enum Ed25519Strict {
  static func verify(signature: Data, message: Data, publicKey: Data) -> Bool {
    guard signature.count == 64, publicKey.count == 32 else { return false }
    let sig = [UInt8](signature)
    let pk = [UInt8](publicKey)
    let r = Array(sig[0..<32])
    let s = Array(sig[32..<64])
    guard lessThan(s, groupOrder),
          isCanonicalPoint(r),
          isCanonicalPoint(pk),
          !smallOrderPoints.contains(pk)
    else { return false }
    guard let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKey) else { return false }
    return key.isValidSignature(signature, for: message)
  }

  /// L = 2^252 + 27742317777372353535851937790883648493, little-endian.
  static let groupOrder: [UInt8] = hex("edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010")
  /// p = 2^255 - 19, little-endian.
  static let fieldPrime: [UInt8] = hex("edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f")

  /// Canonical encodings of the 8 points of order 1, 2, 4 and 8.
  static let smallOrderPoints: Set<[UInt8]> = Set([
    "0100000000000000000000000000000000000000000000000000000000000000",
    "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
    "0000000000000000000000000000000000000000000000000000000000000080",
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
    "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
    "0000000000000000000000000000000000000000000000000000000000000000",
    "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",
  ].map(hex))

  /// y < p, and not (x = 0 with the sign bit set). x = 0 exactly when y = 1 or y = p - 1.
  static func isCanonicalPoint(_ encoded: [UInt8]) -> Bool {
    var y = encoded
    let signBit = y[31] & 0x80 != 0
    y[31] &= 0x7f
    guard lessThan(y, fieldPrime) else { return false }
    if signBit {
      var one = [UInt8](repeating: 0, count: 32)
      one[0] = 1
      var pMinusOne = fieldPrime
      pMinusOne[0] -= 1
      if y == one || y == pMinusOne { return false }
    }
    return true
  }

  /// a < b for 32-byte little-endian integers.
  static func lessThan(_ a: [UInt8], _ b: [UInt8]) -> Bool {
    for i in stride(from: 31, through: 0, by: -1) where a[i] != b[i] {
      return a[i] < b[i]
    }
    return false
  }

  private static func hex(_ s: String) -> [UInt8] {
    var out = [UInt8]()
    out.reserveCapacity(s.count / 2)
    var i = s.startIndex
    while i < s.endIndex {
      let j = s.index(i, offsetBy: 2)
      out.append(UInt8(s[i..<j], radix: 16)!)
      i = j
    }
    return out
  }
}
