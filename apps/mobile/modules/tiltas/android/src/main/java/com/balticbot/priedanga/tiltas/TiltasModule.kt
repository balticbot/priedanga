package com.balticbot.priedanga.tiltas

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class OfferRecord : Record {
  @Field val envelope: String = ""
  @Field val priority: Int = 0
  @Field val expires: Double = 0.0
}

/** Thin bridge to MeshEngine (via TiltasService). Envelopes and keys cross as hex strings. */
class TiltasModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext) { "no React context" }
  private val engine get() = TiltasRuntime.engine(context)

  private fun MeshStatus.toMap(): Map<String, Any> = buildMap {
    put("bluetooth", bluetooth)
    put("running", running)
    put("served", served)
    put("inbox", inbox)
    put("peersSeen", peersSeen)
    put("sessions", sessions)
    put("received", received)
    lastSync?.let { put("lastSync", it.toDouble()) }
  }

  override fun definition() = ModuleDefinition {
    Name("Tiltas")
    Events("onStatus", "onInbox")

    OnCreate {
      engine.onStatus = { sendEvent("onStatus", it.toMap()) }
      engine.onInbox = { sendEvent("onInbox", mapOf("count" to it)) }
    }

    OnDestroy {
      engine.onStatus = null
      engine.onInbox = null
    }

    Function("getStatus") { engine.status().toMap() }

    /** Starts the foreground service; the JS side asks for Bluetooth permissions first. */
    Function("start") { title: String, text: String ->
      val intent = Intent(context, TiltasService::class.java)
        .putExtra(TiltasService.EXTRA_TITLE, title)
        .putExtra(TiltasService.EXTRA_TEXT, text)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    }

    Function("stop") {
      context.stopService(Intent(context, TiltasService::class.java))
      engine.stop()
    }

    Function("setOffers") { offers: List<OfferRecord> ->
      engine.setOffers(offers.mapNotNull { o ->
        val env = o.envelope.hexToBytes() ?: return@mapNotNull null
        if (o.priority !in 0..3 || o.expires < 0 || o.expires > 0xffffffffL.toDouble()) return@mapNotNull null
        Triple(env, o.priority, o.expires.toLong())
      })
    }

    Function("drainInbox") { engine.drainInbox().map { it.hex() } }

    Function("markRejected") { keys: List<String> ->
      engine.markRejected(keys.mapNotNull { it.hexToBytes() })
    }
  }
}
