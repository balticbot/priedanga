# Priedanga — Project status

Last updated: 2026-10-18. Compact overview of what exists, how it fits together, how to run it, and what is open. Details live in the linked docs.

## What Priedanga is

Offline-first public warning and shelter app for Lithuania (Balticbot). Works with full, congested or no network. Signed alerts, offline shelters and maps, guidance in LT/EN/RU/PL/UK. Not affiliated with any government body; only TEST alerts and clearly labelled relayed official messages are shown.

Docs: [MVP scope](mvp-scope.md) · [Architecture](architecture.md) · [Ideas backlog](ideas-backlog.md) (I-1…I-5) · [Budrus analysis](competitive/budrus.md) · [Alert format SPEC](../packages/alert-format/SPEC.md) · [Tiltas SPEC](../packages/tiltas/SPEC.md) · [Tiltas field test](tiltas-field-test.md)

## Repository map

| Path | What |
|---|---|
| `packages/alert-format` | Trust core: strict CBOR, Ed25519 (strict, domain-separated), certificates (roles: live/test issuer, content, live/test relay), revocation, alerts, signed manifests, sync + async (injectable verifier) APIs, 77+ test vectors |
| `packages/content-builder` | Builds the signed content pack: PAGD registers (shelters, KAS, evacuation, sirens) + municipality/county codes from data.gov.lt, `content/guidance`, `content/checklists`. Dev keys in `secrets/dev/` |
| `packages/relay` | PAGD warning feed → signed relay alerts (verbatim text, level from official wording, gazetteer area parser). Dev feed server with optional TEST alert |
| `packages/region-builder` | Offline region packs: PMTiles extract of the Protomaps OSM build (range requests, own PMTiles writer) + walking graph (Overpass, 3 mirrors + retry), signed. Region index + dev server. Shared A* routing (`route.ts`) |
| `content/guidance` | 13 topics (8 emergency, 5 first aid), 5 languages, cited sources, review status |
| `content/checklists` | 4 checklists (go-bag, 72 h supplies, family plan, before leaving) |
| `packs/dev` | Current signed dev content pack (committed) |
| `packs/regions/` | Region packs (git-ignored, built locally) |
| `packages/tiltas` | Tiltas BLE mesh protocol v1: [SPEC](../packages/tiltas/SPEC.md), frame codecs, verify-and-relay (`accept.ts`), reference node, crowd simulation, 35 frame vectors |
| `apps/mobile/modules/tiltas` | Tiltas native engines: Swift/CoreBluetooth (iOS; SwiftPM package with `swift test` and `swift run tiltas-peer`, a macOS test peer) and Kotlin/Android BLE with a foreground service (`./gradlew :tiltas:testDebugUnitTest` runs the vectors) |
| `apps/mobile` | Expo SDK 58 / RN 0.88 app (iOS, Android, web) |

## App features (built)

- **Verified content pack** on startup: root-pinned certs → manifest signature → per-file SHA-256 (native SHA-256 and native Ed25519 via `modules/priedanga-crypto`). Release cold start ~104 ms on simulator.
- **Nearest shelters/KAS/evacuation/sirens** with distance, bearing, filters, accessible-only; place detail shows register gaps honestly.
- **Siren coverage** from official audible radius.
- **GPS** with Lithuania sanity check; manual municipality fallback.
- **Live alerts**: relay feed polled every 60 s, each item verified; current air alert for your municipality; nearest shelter shown under the banner; history verified as of issue time; TEST badge; "relayed, not signed by PAGD" note.
- **Guidance library + first aid**, linked from alerts ("Ką daryti"); CPR metronome (110/min, 30:2, haptics, keep-awake); tourniquet timer (persists across restarts); OS read-aloud where a voice exists.
- **Preparedness checklists** with household-size scaling, ticks saved on device.
- **Offline map** (MapLibre, local PMTiles, Lithuanian labels, local glyphs) with shelters and **offline A\* walking routes**; picks the installed region containing you.
- **Offline maps screen**: download regions on demand (Kaunas 16 MB, Vilnius 27 MB) with progress, update, delete. Install = temp folder → content-key signature + per-file SHA-256 → swap; tampered download rejected, old copy kept. Listing checks signatures/sizes; the region in use is fully hashed.
- **Tiltas mesh (iOS + Android, not yet tested over the air)**: Android asks for Bluetooth permissions and runs as a foreground service with a notification; home switch; auto-on while a danger alert is active or offline. Native engine serves verified alerts and fetches missing ones (content-addressed keys, chunked GATT reads); fetched envelopes wait in an inbox until JS verifies them; only verified alerts are relayed, with hops + 1 (limit 16); failures are not fetched again for 1 h. Mesh alerts are labelled "received over Tiltas". Simulator has no Bluetooth: card says "not supported".
- **5 languages** for all UI; LT default. RU/PL/UK drafts need native review.

## Run it

```bash
npm install
npm run build:packages
npm test                                   # ~246 tests across workspaces
npm run pack -- --offline                  # rebuild packs/dev from cache + content/
npm run region -- build vilnius            # build a region pack (network), refreshes packs/regions/index.json
npm run region -- serve                    # region downloads on :8788 (app default EXPO_PUBLIC_REGIONS_URL)
npm run relay -- serve --days 60 --demo red --demo-area "Kauno m."   # feed + TEST alert on :8787
(cd apps/mobile/modules/tiltas/ios && swift test)                     # Swift frames vs shared vectors
npm run offers -w @priedanga/tiltas > /tmp/offers.json && (cd apps/mobile/modules/tiltas/ios && swift run tiltas-peer --offers /tmp/offers.json)   # Mac BLE test peer
npm run web -w @priedanga/mobile           # web (no map)
```

Native iOS (this Mac): `export LANG=en_US.UTF-8 SSL_CERT_FILE=/etc/ssl/cert.pem PATH="/opt/homebrew/opt/ruby/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:$PATH"`, then in `apps/mobile`: `CI=1 npx expo run:ios --device <udid>` (add `--configuration Release` for timings). CocoaPods is a gem under Homebrew Ruby (Homebrew `ca-certificates` is broken). If Xcode hangs resolving the MapLibre Swift package, seed `~/Library/Caches/org.swift.swiftpm/artifacts/` with the xcframework zip via curl (checksum is verified by SPM).

## Key decisions

- Cell broadcast stays the primary alarm; Priedanga is the layer after it.
- Alerts: CBOR + Ed25519, signatures over exact bytes, fixed check order, relay role for copied official messages; text limit 768 B (official texts reach ~600 B).
- Area codes = official municipality codes (11–94) from the Address Register.
- Content is written in our own words from cited official sources (PAGD, SAM/RSC, ERC 2025); everything marked draft until reviewed.
- iOS 27 requires UIScene → Expo SDK 58. Path-with-space fix: `plugins/withQuotedBundleScript`.
- Repo is public: only test/dev public keys committed; secrets in `secrets/dev/` (git-ignored).

## PR stack

| PR | Branch | Content |
|---|---|---|
| balticbot/priedanga#1 | `feat/alert-format` | Trust core + relay role |
| balticbot/priedanga#2 | `feat/content-pack` | Content pack, app shell, SDK 58 |
| balticbot/priedanga#3 | `feat/native-ed25519` | Native Ed25519 |
| (no PR yet) | `feat/relay-feed` | Relay + alerts UI, guidance, first aid, checklists, region builder, offline map, region downloads |
| (no PR yet) | `feat/tiltas` (on top of relay-feed) | Tiltas protocol, Swift engine, app integration |

## Open / next

- Regions: hosting (CDN) for packs, all-Lithuania coverage, resumable downloads, map taps ignored while a large region is still loading (show a loading hint).
- **Tiltas next:** over-the-air test (iPhone + Mac peer, then 2+ iPhones), measure time-to-spread; native verification so iPhones can relay in the background; CoreBluetooth state restoration; revocations over the mesh.
- Hosting decisions: relay feed, region packs (CDN), production keys/HSM.
- Push delivery (FCM/APNs), iOS Critical Alerts entitlement.
- Reviews: PAGD (guidance/checklists), medical (first aid), native speakers (RU/PL/UK).
- Relay latency vs cell broadcast (run `relay serve` during real alerts).
- Android: builds here (OpenJDK 17 via Homebrew, SDK in `~/Library/Android/sdk`). `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=~/Library/Android/sdk`, then `npx expo prebuild -p android` and `cd android && ./gradlew assembleRelease`.
- Backlog: I-1 community shelter info, I-2 sightings, I-4 lock reports/community shelters, I-5 AI panic plan.
