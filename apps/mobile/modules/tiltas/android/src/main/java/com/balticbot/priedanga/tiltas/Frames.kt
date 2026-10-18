// Tiltas v1 wire frames (packages/tiltas/SPEC.md §2). Mirrors
// packages/tiltas/src/protocol.ts and ios/Core/Frames.swift; must pass
// packages/tiltas/test-vectors/frames.json. No Android imports: JVM-testable.

package com.balticbot.priedanga.tiltas

import java.security.MessageDigest
import java.util.UUID

object Tiltas {
  const val VERSION: Byte = 1
  val SERVICE_UUID: UUID = UUID.fromString("9E48E5B5-A636-4FC6-8312-05C46E541BEC")
  val INVENTORY_UUID: UUID = UUID.fromString("A247668E-46A8-48A7-A7F7-9C774346DC20")
  val SELECT_UUID: UUID = UUID.fromString("E6F3F542-B066-4CB9-B85D-01C4FA01E412")
  val CHUNK_UUID: UUID = UUID.fromString("114CED89-DD83-444E-AF0B-C382940F1D4C")

  const val KEY_BYTES = 8
  const val MAX_INVENTORY = 32
  const val MAX_ENVELOPE = 1024
  const val CHUNK_PAYLOAD = 480
  const val MAX_CHUNKS = 3
  const val MAX_PRIORITY = 3
  internal const val ENTRY_BYTES = KEY_BYTES + 1 + 4
}

class FrameException(message: String) : Exception(message)

/** Content-compared byte key, usable in sets and maps. */
class Key(bytes: ByteArray) {
  val bytes: ByteArray = bytes.copyOf()
  override fun equals(other: Any?) = other is Key && bytes.contentEquals(other.bytes)
  override fun hashCode() = bytes.contentHashCode()
  override fun toString() = bytes.hex()
}

data class InventoryEntry(val key: Key, val priority: Int, val expires: Long) {
  companion object {
    /** Priority desc, expires desc, then key ascending (SPEC §2.1). */
    val URGENCY: Comparator<InventoryEntry> = Comparator { a, b ->
      when {
        a.priority != b.priority -> b.priority - a.priority
        a.expires != b.expires -> b.expires.compareTo(a.expires)
        else -> compareKeys(a.key.bytes, b.key.bytes)
      }
    }

    private fun compareKeys(a: ByteArray, b: ByteArray): Int {
      for (i in 0 until minOf(a.size, b.size)) {
        val d = (a[i].toInt() and 0xff) - (b[i].toInt() and 0xff)
        if (d != 0) return d
      }
      return a.size - b.size
    }
  }
}

data class Chunk(val index: Int, val total: Int, val payload: ByteArray)

object Frames {
  val NOT_AVAILABLE: ByteArray = byteArrayOf(Tiltas.VERSION, 0, 0)

  private fun fail(msg: String): Nothing = throw FrameException(msg)

  private fun u8(b: ByteArray, i: Int) = b[i].toInt() and 0xff

  /** SHA-256 of the signed body, first 8 bytes (SPEC §1.2). */
  fun meshKey(body: ByteArray): Key = Key(MessageDigest.getInstance("SHA-256").digest(body).copyOf(Tiltas.KEY_BYTES))

  fun encodeInventory(entries: List<InventoryEntry>): ByteArray {
    if (entries.size > Tiltas.MAX_INVENTORY) fail("too many entries")
    val out = ByteArray(2 + Tiltas.ENTRY_BYTES * entries.size)
    out[0] = Tiltas.VERSION
    out[1] = entries.size.toByte()
    val seen = HashSet<Key>()
    entries.sortedWith(InventoryEntry.URGENCY).forEachIndexed { i, e ->
      if (e.key.bytes.size != Tiltas.KEY_BYTES) fail("bad key length")
      if (e.priority !in 0..Tiltas.MAX_PRIORITY) fail("bad priority")
      if (e.expires !in 0..0xffffffffL) fail("bad expires")
      if (!seen.add(e.key)) fail("duplicate key")
      val at = 2 + i * Tiltas.ENTRY_BYTES
      e.key.bytes.copyInto(out, at)
      out[at + Tiltas.KEY_BYTES] = e.priority.toByte()
      for (j in 0 until 4) out[at + Tiltas.KEY_BYTES + 1 + j] = (e.expires shr (24 - 8 * j)).toByte()
    }
    return out
  }

  fun decodeInventory(frame: ByteArray): List<InventoryEntry> {
    if (frame.size < 2 || frame[0] != Tiltas.VERSION) fail("bad version")
    val count = u8(frame, 1)
    if (count > Tiltas.MAX_INVENTORY) fail("too many entries")
    if (frame.size != 2 + Tiltas.ENTRY_BYTES * count) fail("bad length")
    val seen = HashSet<Key>()
    return (0 until count).map { i ->
      val at = 2 + i * Tiltas.ENTRY_BYTES
      val key = Key(frame.copyOfRange(at, at + Tiltas.KEY_BYTES))
      val priority = u8(frame, at + Tiltas.KEY_BYTES)
      if (priority > Tiltas.MAX_PRIORITY) fail("bad priority")
      if (!seen.add(key)) fail("duplicate key")
      var expires = 0L
      for (j in 0 until 4) expires = (expires shl 8) or u8(frame, at + Tiltas.KEY_BYTES + 1 + j).toLong()
      InventoryEntry(key, priority, expires)
    }
  }

  fun encodeSelect(key: Key, index: Int): ByteArray {
    if (key.bytes.size != Tiltas.KEY_BYTES) fail("bad key length")
    if (index !in 0 until Tiltas.MAX_CHUNKS) fail("bad index")
    return byteArrayOf(Tiltas.VERSION) + key.bytes + byteArrayOf(index.toByte())
  }

  fun decodeSelect(frame: ByteArray): Pair<Key, Int> {
    if (frame.size != 2 + Tiltas.KEY_BYTES || frame[0] != Tiltas.VERSION) fail("bad select")
    val index = u8(frame, 1 + Tiltas.KEY_BYTES)
    if (index >= Tiltas.MAX_CHUNKS) fail("bad index")
    return Key(frame.copyOfRange(1, 1 + Tiltas.KEY_BYTES)) to index
  }

  fun chunkCount(length: Int) = (length + Tiltas.CHUNK_PAYLOAD - 1) / Tiltas.CHUNK_PAYLOAD

  /** CHUNK frame [index] of [envelope], or NOT_AVAILABLE if out of range. */
  fun encodeChunk(envelope: ByteArray, index: Int): ByteArray {
    if (envelope.isEmpty() || envelope.size > Tiltas.MAX_ENVELOPE) return NOT_AVAILABLE
    val total = chunkCount(envelope.size)
    if (index !in 0 until total) return NOT_AVAILABLE
    val payload = envelope.copyOfRange(index * Tiltas.CHUNK_PAYLOAD, minOf(envelope.size, (index + 1) * Tiltas.CHUNK_PAYLOAD))
    return byteArrayOf(Tiltas.VERSION, index.toByte(), total.toByte()) + payload
  }

  fun decodeChunk(frame: ByteArray): Chunk {
    if (frame.size < 3 || frame[0] != Tiltas.VERSION) fail("bad chunk")
    val index = u8(frame, 1)
    val total = u8(frame, 2)
    val payload = frame.copyOfRange(3, frame.size)
    if (total == 0) {
      if (index != 0 || payload.isNotEmpty()) fail("bad not-available frame")
      return Chunk(0, 0, payload)
    }
    if (total > Tiltas.MAX_CHUNKS || index >= total) fail("bad index")
    val last = index == total - 1
    val ok = if (last) payload.size in 1..Tiltas.CHUNK_PAYLOAD else payload.size == Tiltas.CHUNK_PAYLOAD
    if (!ok) fail("bad payload length")
    return Chunk(index, total, payload)
  }

  fun reassemble(chunks: List<Chunk>): ByteArray {
    val total = chunks.firstOrNull()?.total ?: fail("incomplete")
    if (total == 0 || chunks.size != total) fail("incomplete")
    var out = ByteArray(0)
    chunks.forEachIndexed { i, c ->
      if (c.index != i || c.total != total) fail("chunk out of order")
      out += c.payload
    }
    return out
  }

  // Envelope shape check (SPEC §2.4)

  private fun head(b: ByteArray, at: Int, major: Int): Pair<Int, Int> {
    if (at >= b.size || (u8(b, at) shr 5) != major) fail("unexpected item")
    val info = u8(b, at) and 0x1f
    if (info < 24) return info to at + 1
    val width = when (info) { 24 -> 1; 25 -> 2; 26 -> 4; else -> 0 }
    if (width == 0 || at + 1 + width > b.size) fail("unsupported length")
    var value = 0L
    for (i in 0 until width) value = (value shl 8) or u8(b, at + 1 + i).toLong()
    val min = when (width) { 1 -> 24L; 2 -> 0x100L; else -> 0x10000L }
    if (value < min) fail("non-shortest length")
    if (value > Int.MAX_VALUE) fail("too large")
    return value.toInt() to at + 1 + width
  }

  /** The signed body, if [envelope] has the alert-envelope shape `[uint, bstr, bstr(64), uint]`. */
  fun envelopeBody(envelope: ByteArray): ByteArray {
    if (envelope.size > Tiltas.MAX_ENVELOPE) fail("too large")
    if (envelope.isEmpty() || u8(envelope, 0) != 0x84) fail("not a 4-item array")
    var at = head(envelope, 1, 0).second
    val (bodyLen, bodyAt) = head(envelope, at, 2)
    if (bodyAt + bodyLen > envelope.size) fail("truncated body")
    val body = envelope.copyOfRange(bodyAt, bodyAt + bodyLen)
    at = bodyAt + bodyLen
    val (sigLen, sigAt) = head(envelope, at, 2)
    if (sigLen != 64 || sigAt + 64 > envelope.size) fail("bad signature length")
    at = head(envelope, sigAt + 64, 0).second
    if (at != envelope.size) fail("trailing bytes")
    return body
  }

  /** [envelopeBody] plus the content-address check against the requested key. */
  fun checkEnvelope(envelope: ByteArray, key: Key): ByteArray {
    val body = envelopeBody(envelope)
    if (meshKey(body) != key) fail("key mismatch")
    return body
  }
}

fun ByteArray.hex(): String = joinToString("") { "%02x".format(it.toInt() and 0xff) }

fun String.hexToBytes(): ByteArray? {
  if (length % 2 != 0) return null
  return try {
    ByteArray(length / 2) { substring(it * 2, it * 2 + 2).toInt(16).toByte() }
  } catch (e: NumberFormatException) {
    null
  }
}
