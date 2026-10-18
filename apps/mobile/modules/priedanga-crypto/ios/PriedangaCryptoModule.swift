import ExpoModulesCore

public class PriedangaCryptoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PriedangaCrypto")

    // Synchronous JSI call: one verification takes tens of microseconds, less
    // than a hop to a background queue. The JS wrapper returns a Promise.
    Function("verifyEd25519") { (signature: Data, message: Data, publicKey: Data) -> Bool in
      Ed25519Strict.verify(signature: signature, message: message, publicKey: publicKey)
    }
  }
}
