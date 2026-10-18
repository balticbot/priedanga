# Priedanga Alert Format — Specification v1

Status: draft, normative for all implementations (TypeScript, Kotlin, Swift).
Reference implementation: `src/`. Conformance suite: `test-vectors/v1.json`.

The key words MUST, MUST NOT, SHOULD are used as in RFC 2119.

## 1. Goals

- An alert is shown to a user **only** if it verifies against a root key pinned in the app.
- Every path (push, mesh, content pack) is untrusted; verification is identical regardless of how bytes arrived.
- Each valid object has **exactly one** byte encoding, so independent implementations cannot disagree about what was signed.
- A typical alert fits in ~130 bytes (measured: 127 bytes for a template alert with no free text).

## 2. Encoding: deterministic CBOR profile

All objects use CBOR (RFC 8949) restricted to this profile.

**Allowed:** unsigned integers (major type 0) up to 2^53−1; byte strings (2); text strings (3); arrays (4); maps (5) whose keys are unsigned integers or text strings; `false` (0xf4) and `true` (0xf5).

**Encoders MUST** produce RFC 8949 §4.2.1 core deterministic encoding: shortest-form arguments, definite lengths only, and map entries sorted by the bytewise lexicographic order of their encoded keys.

**Decoders MUST reject:**
- non-shortest integer or length arguments
- indefinite-length items
- negative integers, tags, floats, `null`, `undefined`, other simple values
- map keys that are not strictly ascending (covers duplicates) or not uint/text
- invalid UTF-8 in text strings (overlong forms, surrogates, code points > U+10FFFF, truncation)
- any bytes after the top-level item
- nesting deeper than 8, or more than 4096 items in total

Consequence: `encode(decode(x)) == x` for every accepted `x`.

## 3. Cryptography

### 3.1 Signatures

- Algorithm: **Ed25519** (RFC 8032), 32-byte public keys, 64-byte signatures.
- Verification MUST be strict RFC 8032 (no ZIP-215 relaxations): reject non-canonical `S` and non-canonical point encodings.
- Every signature covers a **domain-separated message**:

```
message = UTF-8(context) || 0x00 || body
```

| Context string | Used for | Signed by |
|---|---|---|
| `priedanga/v1/alert` | alert bodies | issuer key |
| `priedanga/v1/cert` | certificate bodies | root key |
| `priedanga/v1/revocation` | revocation list bodies | root key |

A signature made under one context MUST NOT verify under another.

### 3.2 Key IDs

```
keyId = SHA-256( UTF-8("priedanga/v1/keyid") || 0x00 || publicKey )[0..8]
```

## 4. Objects

Integer map keys are part of the wire contract and MUST NOT be renumbered. Unknown keys MUST be rejected (v1 has no silent extension mechanism; extensions bump the version).

### 4.1 Alert body

| Key | Field | Type | Rules |
|---|---|---|---|
| 0 | v | uint | MUST be 1 |
| 1 | id | bstr(16) | random; unique per message |
| 2 | issuerKeyId | bstr(8) | key ID of the signing certificate |
| 3 | issued | uint | Unix seconds |
| 4 | expires | uint | Unix seconds; MUST be > issued |
| 5 | msgType | uint | 0 alert, 1 update, 2 cancel |
| 6 | ref | bstr(16) | REQUIRED for update and cancel; FORBIDDEN for alert |
| 7 | level | uint | 1 yellow, 2 red, 3 yellow-after-red, 4 white. REQUIRED for alert/update; FORBIDDEN for cancel |
| 8 | category | uint | 1 air, 2 chemical, 3 radiation, 4 flood, 5 other. Same presence rule as level |
| 9 | areas | array of uint | non-empty, strictly ascending, each 0–255. `0` = nationwide and MUST then be the only entry |
| 10 | template | uint | 0–65535. Same presence rule as level |
| 11 | text | map tstr → tstr | OPTIONAL. Keys from {`lt`,`en`,`ru`,`pl`,`uk`}; values non-empty, ≤ 512 UTF-8 bytes; map non-empty if present |
| 12 | test | bool | REQUIRED |

### 4.2 Certificate body

| Key | Field | Type | Rules |
|---|---|---|---|
| 0 | v | uint | MUST be 1 |
| 1 | keyId | bstr(8) | MUST equal keyId(publicKey) |
| 2 | publicKey | bstr(32) | Ed25519 public key |
| 3 | role | uint | 1 live issuer, 2 test issuer, 3 content |
| 4 | validFrom | uint | Unix seconds, inclusive |
| 5 | validTo | uint | Unix seconds, inclusive; MUST be > validFrom |
| 6 | areas | array of uint | REQUIRED for issuer roles, FORBIDDEN for content; same rules as alert areas |
| 7 | name | tstr | non-empty, ≤ 128 UTF-8 bytes |

### 4.3 Revocation list body

| Key | Field | Type | Rules |
|---|---|---|---|
| 0 | v | uint | MUST be 1 |
| 1 | seq | uint | monotonically increasing |
| 2 | issued | uint | Unix seconds |
| 3 | keyIds | array of bstr(8) | strictly ascending (bytewise) |
| 4 | alertIds | array of bstr(16) | strictly ascending (bytewise) |

## 5. Envelopes

**Alert envelope:** `[version: uint, body: bstr, signature: bstr(64), hops: uint]`

- `body` is the exact signed byte string. Verifiers MUST verify the signature over these received bytes, never over a re-encoding.
- `hops` is outside the signature. Relays increment it; it cannot change the alert's meaning.

**Signed object** (certificates, revocation lists): `[body: bstr, signature: bstr(64)]`

## 6. Verification algorithm

### 6.1 Trust store

1. The root public key is pinned in the application binary.
2. For each certificate: decode the signed object; verify the signature under `priedanga/v1/cert` with the root key; decode the body. Reject on any failure. Reject a second certificate with an already-present key ID.
3. For the revocation list: verify under `priedanga/v1/revocation` with the root key. A store MUST NOT replace a revocation list with one whose `seq` is lower than the one it holds.

### 6.2 Alert verification

Checks MUST run in this order; the **first** failing check determines the reason code. Implementations MUST return the same reason code as the reference for every vector.

| # | Check | Reason |
|---|---|---|
| 1 | envelope length ≤ maxEnvelopeBytes (before parsing) | `TOO_LARGE` |
| 2 | envelope decodes per §2 and §5 | `MALFORMED` |
| 3 | envelope version == 1 | `UNSUPPORTED_VERSION` |
| 4 | body decodes and satisfies §4.1 | `MALFORMED` |
| 5 | certificate with `issuerKeyId` exists in the store | `UNKNOWN_ISSUER` |
| 6 | signature verifies under `priedanga/v1/alert` with that certificate's key | `BAD_SIGNATURE` |
| 7 | issuer key ID not revoked | `ISSUER_REVOKED` |
| 8 | issuer role is not content | `ROLE_NOT_ALLOWED` |
| 9 | `test == true` ⇔ role is test issuer; `test == false` ⇔ role is live issuer | `TEST_MISMATCH` |
| 10 | validFrom ≤ issued ≤ validTo | `ISSUER_NOT_VALID` |
| 11 | alert areas allowed by certificate areas (cert `[0]` allows all; otherwise alert MUST NOT be nationwide and every alert area MUST be listed) | `AREA_NOT_ALLOWED` |
| 12 | issued ≤ now + clockSkewSeconds | `NOT_YET_VALID` |
| 13 | expires > now | `EXPIRED` |
| 14 | expires − issued ≤ maxLifetimeSeconds | `LIFETIME_TOO_LONG` |
| 15 | alert ID not revoked | `ALERT_REVOKED` |
| 16 | hops ≤ maxHops | `HOPS_EXCEEDED` |

### 6.3 Default policy

| Parameter | Value |
|---|---|
| maxEnvelopeBytes | 1024 |
| maxHops | 16 |
| clockSkewSeconds | 300 |
| maxLifetimeSeconds | 604800 (7 days) |

The lifetime cap also bounds the damage of a leaked issuer key after its certificate expires: an alert must be issued within the certificate window and cannot outlive its issue time by more than 7 days.

## 7. After verification (application rules)

- **Area relevance:** an alert applies to the device if its areas contain `0` or the device's area code. This runs on the device; location never leaves it.
- **Deduplication:** keep a store of seen alert IDs until their expiry; show each ID once, but relays MAY keep advertising it.
- **Update / cancel:** an update supersedes the alert named in `ref`; a cancel withdraws it. Both are verified exactly like an alert.
- **Clock sanity:** `now` comes from the device clock. Where available, compare against GNSS time and treat large disagreement as a warning.
- **Mesh relays** MUST verify before storing or relaying, and MUST relay with `hops + 1`.

## 8. Conformance

`test-vectors/v1.json` contains:

- `trust`: pinned root public key, certificates and revocation list to build the store.
- `certificateVectors`: single certificates with the expected trust-store outcome.
- `alertVectors`: envelopes with the expected result at `now`. For `OK` vectors, `decoded` lists every field an implementation must reproduce.

An implementation is conformant when it returns the expected outcome and reason code for every vector. All vector keys are derived from public seeds and are for tests only.

## 9. Versioning

Any change to field semantics, keys, contexts or the CBOR profile requires a new version number in envelopes and bodies, a new set of context strings (`priedanga/v2/...`) and a new vector file. v1 verifiers MUST reject v2 objects (`UNSUPPORTED_VERSION` / `MALFORMED`).
