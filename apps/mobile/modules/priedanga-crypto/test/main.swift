// Conformance harness for Ed25519Strict.swift on macOS (same CryptoKit as iOS).
// stdin: one "signatureHex messageHex publicKeyHex" per line; stdout: "1" or "0" per line.
// Built and run by apps/mobile/test/nativeEd25519.test.ts.
import Foundation

func bytes(_ hex: Substring) -> Data {
  var out = Data(capacity: hex.count / 2)
  var i = hex.startIndex
  while i < hex.endIndex {
    let j = hex.index(i, offsetBy: 2)
    out.append(UInt8(hex[i..<j], radix: 16)!)
    i = j
  }
  return out
}

var output = ""
while let line = readLine() {
  let parts = line.split(separator: " ", omittingEmptySubsequences: false)
  precondition(parts.count == 3, "bad input line")
  let ok = Ed25519Strict.verify(signature: bytes(parts[0]), message: bytes(parts[1]), publicKey: bytes(parts[2]))
  output += ok ? "1\n" : "0\n"
}
FileHandle.standardOutput.write(output.data(using: .utf8)!)
