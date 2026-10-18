# Priedanga — Architecture

Status: draft v0.1 (2026-10-18)
Companion to [mvp-scope.md](mvp-scope.md).

## 1. Principles

1. **Nothing on the read path.** No server is contacted to *show* an alert, a shelter or a guidance page. Servers only exist to *issue* alerts and *publish* content in advance.
2. **Trust comes from signatures, not channels.** Push, mesh and CDN are all treated as untrusted pipes. The phone verifies every alert and every content pack against a pinned public key.
3. **Every layer degrades gracefully.** Losing the internet, the cellular network, a CDN or the push provider removes one path, never the whole system.
4. **Privacy by construction.** No accounts, no device registry with locations, no analytics by default. Area filtering happens on the phone.

## 2. System overview

```
                        QUIET TIME (prepare)                          CRISIS TIME (deliver)
 ┌──────────────────┐                                    ┌─────────────────────────┐
 │ Content builder  │  shelters, guidance, templates,     │ Issuer console (web)    │
 │ (CI pipeline)    │  map tiles, revocation list         │ draft → 2nd approver    │
 └────────┬─────────┘                                    └───────────┬─────────────┘
          │ build + sign manifest                                    │ approved alert
          ▼                                                          ▼
 ┌──────────────────┐   ┌──────────────────┐              ┌─────────────────────────┐
 │ CDN A (EU)       │   │ CDN B (EU)       │              │ Signing service + HSM / │
 │ static packs     │   │ mirror           │              │ hardware key            │
 └────────┬─────────┘   └────────┬─────────┘              └───────────┬─────────────┘
          │  daily delta sync     │                                    │ signed alert
          └──────────┬────────────┘                                    ▼
                     │                                     ┌─────────────────────────┐
                     │                                     │ Alert API → FCM / APNs  │
                     │                                     │ (fan-out to all devices)│
                     ▼                                     └───────────┬─────────────┘
 ┌───────────────────────────────────────────────────────────────────────────────────┐
 │ PHONE (Priedanga app)                                                              │
 │  verify signature → area filter (local) → loud alert → guidance + nearest shelter  │
 │  local store: shelters, map, guidance (5 langs), templates, keys, seen alert IDs   │
 │                                   │                                                │
 │                                   ▼                                                │
 │                  Tiltas: relay signed alert to nearby phones over BLE               │
 └───────────────────────────────────────────────────────────────────────────────────┘

 Independent of all of the above: PAGD cell broadcast + sirens (primary alarm, unchanged)
```

## 3. Delivery paths and failure modes

| Scenario | Cell broadcast | Push (FCM/APNs) | Content on phone | Tiltas mesh | What the user gets |
|---|---|---|---|---|---|
| Normal | ✅ | ✅ | ✅ | idle | Full experience |
| Network congested (today's LT72 failure) | ✅ | ✅ (small payload gets through) | ✅ | active | Full experience — nothing needs downloading |
| Internet down, cellular up | ✅ | ❌ | ✅ | active | CB alarm + offline guidance + mesh-relayed details |
| Cellular and internet down | ❌ | ❌ | ✅ | active | Offline guidance, shelters, map; alerts via mesh from phones that received them |
| CDN taken down | n/a | ✅ | ✅ (last good pack) | n/a | Unaffected; second CDN serves updates |
| Push provider unavailable | ✅ | ❌ | ✅ | active | CB + mesh |

GPS keeps working without cellular, so the shelter finder works in every row. Where GNSS jamming or spoofing is suspected (a known issue in the Baltic region), the app falls back to manual area selection and shows a distance list rather than a single arrow.

## 4. Components

### 4.1 Mobile app

| Concern | Choice | Why |
|---|---|---|
| Framework | **React Native with Expo (dev builds)** | One TypeScript codebase for iOS and Android; matches existing Balticbot skills; native modules where needed |
| Mesh (Tiltas) | **Native modules: Kotlin (Android), Swift (iOS)** | Bluetooth and background execution must be native; must work without the JS runtime |
| Crypto | **Ed25519**: `@noble/curves` (audited, pure TypeScript) in JS; platform crypto / libsodium in native code | No native dependency in JS; native code must pass the same test vectors |
| Storage | **SQLite** | Shelters (thousands of rows — simple bounding-box query is enough), seen alert IDs, settings |
| Map | **MapLibre Native** with offline vector tiles built from an OpenStreetMap extract of Lithuania | Open source, no API keys, fully offline |
| Text-to-speech | OS built-in engines | Offline; readout of guidance and alerts |
| Notifications | Android high-importance channel + full-screen intent; iOS Critical Alerts (entitlement pending) | Must be heard in silent/Do Not Disturb mode |

### 4.2 Issuer console and alert API

- **Console:** Next.js web app, EU-hosted, behind strong authentication (hardware security keys / passkeys only). Drafting, preview in all languages, approval by a second person, audit log.
- **Signing service:** small isolated service. The issuer private key lives in an HSM or on a hardware key (e.g. a YubiKey-class device); the service signs only approved alerts and refuses anything else.
- **Alert API:** hands the signed payload to FCM (Android and iOS via FCM topics) and/or APNs. It is not on any read path: if it is overloaded, phones that already have the alert are unaffected.
- **Fan-out speed:** topic fan-out at national scale is rate-limited by the providers; delivery to ~3 million devices may take minutes, not seconds. That must be load-tested. It is also why cell broadcast remains the primary alarm and Priedanga is the second layer.

### 4.3 Content pipeline

- Source data (shelters, guidance texts, templates, LRT radio frequencies, revocation list) lives in a Git repository; every change is reviewed.
- CI builds versioned packs: `shelters.sqlite`, `guidance-<lang>.json`, `templates.json`, `tiles-<region>.mbtiles`.
- A **manifest** lists every file with its SHA-256 hash and size, and is signed with the content key.
- Packs are published to **two independent EU CDNs**. The app tries them in turn, downloads deltas, verifies the manifest signature and hashes, then swaps atomically. On any failure it keeps the last good pack.
- The app ships with a baseline pack in the binary, so even a freshly installed app that never synced has guidance and templates.

## 5. Alert format

### 5.1 Semantic model

Based on the **OASIS Common Alerting Protocol (CAP 1.2)**, the standard used by EU-Alert and most national warning systems. This makes integration with PAGD's system a mapping exercise rather than a redesign.

| Field | Example | Notes |
|---|---|---|
| `id` | 128-bit random | Unique; used for deduplication |
| `issuer` | key ID of the issuer certificate | Tells the phone which key to verify with |
| `issued`, `expires` | Unix seconds | Expired alerts are not shown or relayed |
| `msgType` | alert / update / cancel | Update and cancel reference a previous `id` |
| `level` | yellow / red / yellow-after-red / white | Mirrors official air-alert levels (semantics to confirm with PAGD) |
| `category` | air / chem / rad / flood / other | Selects the guidance page |
| `area` | list of municipality codes, optional polygon | Lithuania has 60 municipalities; codes fit in one byte each |
| `template` | template ID | Expands to full multilingual text from the offline template pack |
| `text` | optional free text per language | Optional; dropped on the mesh if too large |
| `test` | true / false | TEST alerts display differently and must be signed with the test key |

### 5.2 Wire format

- **Encoding:** CBOR with fixed integer keys (compact and deterministic).
- **Signature:** Ed25519 over the canonical CBOR bytes of the signed fields.
- **Size:** a template-based alert with 3 municipalities is about 150 bytes including the 64-byte signature. That fits in a push payload (4 KB limit) and in one short Bluetooth read.
- **Mutable envelope** (outside the signature): `hops` counter for the mesh, receive path. Changing it cannot change the alert content.
- **Test vectors:** the `alert-format` package ships a set of valid and invalid encoded alerts; JS, Kotlin and Swift implementations must all agree on every one.

## 6. Key management

```
Root key (offline, never on a networked machine; split between custodians)
 ├── signs → Issuer certificate: LIVE   (role, valid-from/to, allowed areas)
 ├── signs → Issuer certificate: TEST
 └── signs → Content certificate        (signs pack manifests only)
```

- The app pins the **root public key** at build time.
- Issuer and content certificates are delivered in the content pack and can be rotated without an app update.
- **Revocation:** a signed revocation list in the content pack, plus a signed "revoke" message that can be pushed or relayed over the mesh.
- **Separation of roles:** the content key cannot sign alerts, the test key cannot sign live alerts, and a live alert outside the issuer's allowed areas is rejected.
- **Until a state agreement exists**, only the TEST issuer certificate is created. The LIVE certificate is generated together with the authority, which holds its key.

## 7. Tiltas mesh protocol (v0)

Goal: carry a few small signed alerts across a crowd of phones with no infrastructure.

1. **When it runs.** Active only when an alert is active, or the phone has lost connectivity, or the user turns it on. Otherwise off, to save battery.
2. **Discovery.** Each phone advertises a fixed Priedanga service UUID over Bluetooth LE. It works across iOS and Android because it uses plain BLE GATT, not Nearby Connections or Multipeer Connectivity.
3. **Inventory exchange.** On meeting a peer, a phone connects and reads an *inventory* characteristic: the list of alert IDs it holds (truncated hashes) with level and expiry.
4. **Fetch.** It reads the alerts it is missing, newest and most severe first.
5. **Verify, then store, then relay.** An alert is stored and re-advertised only if its signature verifies, it has not expired, its issuer is not revoked, and `hops` is under the limit (e.g. 16).
6. **Flood control.** Per-peer cool-down, a cap on stored alerts, and deduplication by `id`. A forged alert is rejected at the first phone, so it cannot spread.
7. **Privacy.** No user identifiers; BLE addresses are randomized by the OS; the payload is a public alert anyway.

**Platform limits (honest):**
- **Android:** a foreground service (with a persistent notification) allows continuous scanning and advertising. Full relay node.
- **iOS:** reliable while the app is open. In the background, CoreBluetooth still runs but is throttled: slow scanning, and advertising of the service UUID only. iPhones therefore act mostly as receivers while closed, and as full relays while open. Multipeer Connectivity is not used because it stops in the background.
- Throughput is irrelevant here: alerts are ~150 bytes.

## 8. Threat model (summary)

| Threat | Example | Mitigation |
|---|---|---|
| Fake alerts to cause panic | Adversary injects "red alert" via a rogue app or mesh device | Signatures with pinned root; rejected at the first phone |
| Replay of an old real alert | Re-broadcast last month's red alert | `expires` check; seen-ID store; clock sanity check against GPS time |
| Stolen issuer credentials | Phished console account | Hardware keys only; two-person approval; area-scoped certificates; revocation |
| Malicious content pack | Fake shelter locations pushed via a compromised CDN | Signed manifest + per-file hashes; last good pack kept |
| DDoS on infrastructure | Flood the CDN or API during an attack | Nothing on the read path; two CDNs; API failure doesn't affect phones that have the alert |
| GNSS jamming / spoofing | Wrong position, so wrong "nearest shelter" | Manual area fallback; list view with addresses; sanity checks (position jump, accuracy) |
| Mesh flooding / battery drain | Rogue devices spam connections | Verify before relay; cool-downs; caps; mesh off in normal times |
| Lookalike apps | "Priedanga Pro" spreading misinformation | Store listings verified; public key fingerprint published; state endorsement later |
| Surveillance of users | Track who is where during an alert | No accounts, no location upload, no device registry with locations |

An external penetration test is required before any public pilot.

## 9. Repository layout (proposed)

```
priedanga/
├── apps/
│   ├── mobile/            Expo React Native app
│   └── console/           Next.js issuer console
├── packages/
│   ├── alert-format/      CBOR encode/decode, sign/verify, test vectors (TS)
│   └── content-builder/   builds and signs content packs
├── native/
│   ├── tiltas-android/    Kotlin BLE mesh + libsodium verify (Expo module)
│   └── tiltas-ios/        Swift BLE mesh + libsodium verify (Expo module)
├── content/               source data: shelters, guidance (5 langs), templates
└── docs/
```

npm workspaces monorepo; one shared TypeScript `alert-format` package is the contract that the console, the app and the test vectors all build on. Native modules reimplement verification only and must pass the same test vectors.

## 10. Build order

1. **`alert-format`** — the trust core: format, signing, verification, test vectors. Everything else depends on it.
2. **Content pack + offline app shell** — shelters, guidance, map, airplane-mode demo (success criterion 1).
3. **Issuer console + push delivery** — test issuer, two-person approval, fan-out load test (criterion 2).
4. **Tiltas Android**, then **Tiltas iOS** (criterion 3).
5. **Hardening** — forgery tests on every path (criterion 4), accessibility pass (criterion 5).

## 11. Hosting and sovereignty

- MVP: EU-region hosting for the console and API; two independent EU CDNs for packs.
- Push currently depends on Google (FCM) and Apple (APNs). Acceptable for the MVP: when they are unavailable, cell broadcast and the mesh still work. For national adoption, evaluate self-hosted push for Android (e.g. UnifiedPush) and state-approved hosting for the console and signing service.
