package com.balticbot.priedanga.tiltas

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/** Runs packages/tiltas/test-vectors/frames.json, the same vectors as the TypeScript and Swift implementations. */
class FrameVectorTest {
  private val vectors: JSONObject by lazy {
    // Gradle runs unit tests from the module directory (modules/tiltas/android).
    var dir: File? = File(System.getProperty("user.dir")!!).absoluteFile
    while (dir != null && !File(dir, "packages/tiltas/test-vectors/frames.json").exists()) dir = dir.parentFile
    JSONObject(File(requireNotNull(dir) { "repo root not found" }, "packages/tiltas/test-vectors/frames.json").readText())
  }

  private fun list(name: String) = vectors.getJSONArray(name).let { a -> (0 until a.length()).map { a.getJSONObject(it) } }
  private fun bytes(hex: String) = requireNotNull(hex.hexToBytes())

  private fun assertThrows(name: String, block: () -> Unit) {
    try {
      block()
      fail("$name: expected rejection")
    } catch (e: FrameException) {
      // expected
    }
  }

  @Test fun inventory() {
    val vs = list("inventory")
    assertTrue(vs.size > 5)
    for (v in vs) {
      val name = v.getString("name")
      if (!v.getBoolean("ok")) { assertThrows(name) { Frames.decodeInventory(bytes(v.getString("hex"))) }; continue }
      val entries = Frames.decodeInventory(bytes(v.getString("hex")))
      val expected = v.getJSONArray("entries").let { a -> (0 until a.length()).map { a.getJSONObject(it) } }
      assertEquals(name, expected.map { it.getString("key") }, entries.map { it.key.toString() })
      assertEquals(name, expected.map { it.getInt("priority") }, entries.map { it.priority })
      assertEquals(name, expected.map { it.getLong("expires") }, entries.map { it.expires })
      assertEquals(name, v.getString("hex"), Frames.encodeInventory(entries.reversed()).hex())
    }
  }

  @Test fun select() {
    for (v in list("select")) {
      val name = v.getString("name")
      if (!v.getBoolean("ok")) { assertThrows(name) { Frames.decodeSelect(bytes(v.getString("hex"))) }; continue }
      val (key, index) = Frames.decodeSelect(bytes(v.getString("hex")))
      assertEquals(name, v.getString("key"), key.toString())
      assertEquals(name, v.getInt("index"), index)
      assertEquals(name, v.getString("hex"), Frames.encodeSelect(key, index).hex())
    }
  }

  @Test fun chunk() {
    for (v in list("chunk")) {
      val name = v.getString("name")
      if (!v.getBoolean("ok")) { assertThrows(name) { Frames.decodeChunk(bytes(v.getString("hex"))) }; continue }
      val c = Frames.decodeChunk(bytes(v.getString("hex")))
      assertEquals(name, v.getInt("index"), c.index)
      assertEquals(name, v.getInt("total"), c.total)
      assertEquals(name, v.getString("payload"), c.payload.hex())
    }
  }

  @Test fun envelope() {
    for (v in list("envelope")) {
      val name = v.getString("name")
      val env = bytes(v.getString("hex"))
      val key = Key(bytes(v.getString("key")))
      if (!v.getBoolean("ok")) { assertThrows(name) { Frames.checkEnvelope(env, key) }; continue }
      assertEquals(name, v.getString("body"), Frames.checkEnvelope(env, key).hex())
      val chunks = v.optJSONArray("chunks") ?: continue
      val hexes = (0 until chunks.length()).map { chunks.getString(it) }
      assertEquals(name, hexes, hexes.indices.map { Frames.encodeChunk(env, it).hex() })
      assertEquals(name, v.getString("hex"), Frames.reassemble(hexes.map { Frames.decodeChunk(bytes(it)) }).hex())
      assertArrayEquals(name, Frames.NOT_AVAILABLE, Frames.encodeChunk(env, hexes.size))
    }
  }
}
