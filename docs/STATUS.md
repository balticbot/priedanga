# Priedanga — Project status

Last updated: 2026-10-18. Compact overview of what exists, how it fits together, how to run it, and what is open. Details live in the linked docs.

## What Priedanga is

Offline-first public warning and shelter app for Lithuania (Balticbot). Works with full, congested or no network. Signed alerts, offline shelters and maps, guidance in LT/EN/RU/PL/UK. Not affiliated with any government body; only TEST alerts and clearly labelled relayed official messages are shown.

Docs: [MVP scope](mvp-scope.md) · [Architecture](architecture.md) · [Ideas backlog](ideas-backlog.md) (I-1…I-5) · [Budrus analysis](competitive/budrus.md) · [Alert format SPEC](../packages/alert-format/SPEC.md)

## Repository map

| Path | What |
|---|---|
| `packages/alert-format` | Trust core: strict CBOR, Ed25519 (strict, domain-separated), certificates (roles: live/test issuer, content, live/test relay), revocation, alerts, signed manifests, sync + async (injectable verifier) APIs, 77+ test vectors |
| `packages/content-builder` | Builds the signed content pack: PAGD registers (shelters, KAS, evacuation, sirens) + municipality/county codes from data.gov.lt, `content/guidance`, `content/checklists`. Dev keys in `secrets/dev/` |
| `packages/relay` | PAGD warning feed → signed relay alerts (verbatim text, level from official wording, gazetteer area parser). Dev feed server with optional TEST alert |
| `packages/region-builder` | Offline region packs: PMTiles extract of the Protomaps OSM build (range requests, own PMTiles writer) + walking graph (Overpass), signed. Shared A* routing (`route.ts`) |
| `content/guidance` | 13 topics (8 emergency, 5 first aid), 5 languages, cited sources, review status |
| `content/checklists` | 4 checklists (go-bag, 72 h supplies, family plan, before leaving) |
| `packs/dev` | Current signed dev content pack (committed) |
| `packs/regions/` | Region packs (git-ignored, built locally) |
| `apps/mobile` | Expo SDK 58 / RN 0.88 app (iOS, Android, web) |

## App features (built)

- **Verified content pack** on startup: root-pinned certs → manifest signature → per-file SHA-256 (native SHA-256 and native Ed25519 via `modules/priedanga-crypto`). Release cold start ~104 ms on simulator.
- **Nearest shelters/KAS/evacuation/sirens** with distance, bearing, filters, accessible-only; place detail shows register gaps honestly.
- **Siren coverage** from official audible radius.
- **GPS** with Lithuania sanity check; manual municipality fallback.
- **Live alerts**: relay feed polled every 60 s, each item verified; current air alert for your municipality; nearest shelter shown under the banner; history verified as of issue time; TEST badge; "relayed, not signed by PAGD" note.
- **Guidance library + first aid**, linked from alerts ("Ką daryti"); CPR metronome (110/min, 30:2, haptics, keep-awake); tourniquet timer (persists across restarts); OS read-aloud where a voice exists.
- **Preparedness checklists** with household-size scaling, ticks saved on device.
- **Offline map** (MapLibre, local PMTiles, Lithuanian labels, local glyphs) with shelters and **offline A\* walking routes**.
- **5 languages** for all UI; LT default. RU/PL/UK drafts need native review.

## Run it

```bash
npm install
npm run build:packages
npm test                                   # ~246 tests across workspaces
npm run pack -- --offline                  # rebuild packs/dev from cache + content/
npm run region -- build kaunas             # build a region pack (network)
npm run relay -- serve --days 60 --demo red --demo-area "Kauno m."   # feed + TEST alert on :8787
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
| (no PR yet) | `feat/relay-feed` | Relay + alerts UI, guidance, first aid, checklists, region builder, offline map |

## Open / next

- **Region downloads on demand** (in progress): region index + server, download with progress, verify, delete; Vilnius pack.
- Tiltas BLE mesh (iOS first), native verifier reuse (`Ed25519Strict`).
- Hosting decisions: relay feed, region packs (CDN), production keys/HSM.
- Push delivery (FCM/APNs), iOS Critical Alerts entitlement.
- Reviews: PAGD (guidance/checklists), medical (first aid), native speakers (RU/PL/UK).
- Relay latency vs cell broadcast (run `relay serve` during real alerts).
- Android build never compiled here (no SDK/JDK).
- Backlog: I-1 community shelter info, I-2 sightings, I-4 lock reports/community shelters, I-5 AI panic plan.
