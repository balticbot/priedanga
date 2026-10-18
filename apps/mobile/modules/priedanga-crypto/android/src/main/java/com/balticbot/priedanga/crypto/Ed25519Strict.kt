package com.balticbot.priedanga.crypto

import org.bouncycastle.math.ec.rfc8032.Ed25519

/**
 * Strict RFC 8032 Ed25519 verification, matching the Priedanga JS reference
 * (`@noble/curves` with `zip215: false`) and the iOS `Ed25519Strict.swift` on
 * every vector in `packages/alert-format/test-vectors/ed25519-strict.json`.
 *
 * BouncyCastle does the curve arithmetic. The same byte-level encoding rules
 * as on iOS are enforced first, so both platforms reject exactly the same
 * inputs regardless of library version:
 *   - S must be canonical (S < L)
 *   - R and A must be canonical encodings (y < p; not x = 0 with the sign bit)
 *   - A must not be a small-order point
 *
 * No Expo or Android dependency: the Tiltas mesh can reuse it without the JS
 * runtime. Never throws; anything malformed is `false`.
 */
object Ed25519Strict {
  fun verify(signature: ByteArray, message: ByteArray, publicKey: ByteArray): Boolean {
    if (signature.size != 64 || publicKey.size != 32) return false
    val r = signature.copyOfRange(0, 32)
    val s = signature.copyOfRange(32, 64)
    if (!lessThan(s, GROUP_ORDER) || !isCanonicalPoint(r) || !isCanonicalPoint(publicKey)) return false
    if (SMALL_ORDER_POINTS.any { it.contentEquals(publicKey) }) return false
    return try {
      Ed25519.verify(signature, 0, publicKey, 0, message, 0, message.size)
    } catch (e: RuntimeException) {
      false
    }
  }

  /** L = 2^252 + 27742317777372353535851937790883648493, little-endian. */
  private val GROUP_ORDER = hex("edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010")

  /** p = 2^255 - 19, little-endian. */
  private val FIELD_PRIME = hex("edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f")
  private val FIELD_PRIME_MINUS_ONE = hex("ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f")
  private val ONE = hex("0100000000000000000000000000000000000000000000000000000000000000")

  /** Canonical encodings of the 8 points of order 1, 2, 4 and 8. */
  private val SMALL_ORDER_POINTS = listOf(
    "0100000000000000000000000000000000000000000000000000000000000000",
    "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
    "0000000000000000000000000000000000000000000000000000000000000080",
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
    "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
    "0000000000000000000000000000000000000000000000000000000000000000",
    "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",
  ).map(::hex)

  /** y < p, and not (x = 0 with the sign bit set). x = 0 exactly when y = 1 or y = p - 1. */
  private fun isCanonicalPoint(encoded: ByteArray): Boolean {
    val y = encoded.copyOf()
    val signBit = (y[31].toInt() and 0x80) != 0
    y[31] = (y[31].toInt() and 0x7f).toByte()
    if (!lessThan(y, FIELD_PRIME)) return false
    if (signBit && (y.contentEquals(ONE) || y.contentEquals(FIELD_PRIME_MINUS_ONE))) return false
    return true
  }

  /** a < b for 32-byte little-endian integers. */
  private fun lessThan(a: ByteArray, b: ByteArray): Boolean {
    for (i in 31 downTo 0) {
      val x = a[i].toInt() and 0xff
      val y = b[i].toInt() and 0xff
      if (x != y) return x < y
    }
    return false
  }

  private fun hex(s: String): ByteArray = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
}
