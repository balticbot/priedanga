# priedanga-crypto

Local Expo module: native Ed25519 signature verification.

```ts
import { verifyEd25519 } from '../modules/priedanga-crypto/src';
await verifyEd25519(signature, message, publicKey); // Promise<boolean>, never rejects
```

| Platform | Implementation |
|---|---|
| iOS | CryptoKit `Curve25519.Signing.PublicKey.isValidSignature` (`ios/Ed25519Strict.swift`) |
| Android | BouncyCastle `org.bouncycastle.math.ec.rfc8032.Ed25519` (`android/.../Ed25519Strict.kt`) |
| Web | strict JS reference from `@priedanga/alert-format` (`src/index.web.ts`) |

It plugs into alert-format's `buildTrustStoreAsync`, `verifyManifestAsync` and `verifyAlertAsync`, which take an optional `Ed25519Verifier`.

## Strictness

Both native files enforce, on bytes and before calling the library, the rules of SPEC.md §3.1: `S < L`, canonical `R` and `A` encodings, and no small-order public key. That keeps iOS, Android and the JS reference in agreement regardless of library version. Plain CryptoKit accepts all 8 small-order public keys (with a signature crafted for them), so the small-order check is required.

Both native libraries use the cofactorless equation, the JS reference the cofactored one. They differ only on the `cofactorDependent` vectors, which only the holder of a trusted secret key can produce (SPEC.md §3.1).

`Ed25519Strict` has no Expo or JS dependency, so the Tiltas mesh code can reuse it.

## Conformance

- `apps/mobile/test/nativeEd25519.test.ts` compiles `ios/Ed25519Strict.swift` for macOS (same CryptoKit) with `test/main.swift` and runs every vector in `packages/alert-format/test-vectors/` through it. Skipped without `swiftc`.
- In dev builds, tapping the "pack verified" line on the home screen runs the same check through the native module on the device.
- Android has no host-side test (needs a JVM); use the in-app check on a device or emulator.
