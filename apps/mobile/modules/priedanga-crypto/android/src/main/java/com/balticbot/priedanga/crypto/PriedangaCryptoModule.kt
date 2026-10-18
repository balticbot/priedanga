package com.balticbot.priedanga.crypto

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Uint8Array

class PriedangaCryptoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PriedangaCrypto")

    // Synchronous JSI call: one verification takes well under a millisecond,
    // less than a hop to a background thread. The JS wrapper returns a Promise.
    Function("verifyEd25519") { signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array ->
      Ed25519Strict.verify(signature.toByteArray(), message.toByteArray(), publicKey.toByteArray())
    }
  }

  private fun Uint8Array.toByteArray(): ByteArray = ByteArray(byteLength).also { read(it, 0, byteLength) }
}
