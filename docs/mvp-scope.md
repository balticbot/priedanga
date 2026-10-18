# Priedanga — MVP Scope

Status: draft v0.1 (2026-10-18)
Owner: Lukas Urbanavicius (Balticbot)

## 1. Problem

During air-raid alerts, Lithuanians receive a cell-broadcast message and a siren, then open the official LT72 app or lt72.lt for instructions and shelter locations. Under alert-time load the app and site become unreachable. The moment people need guidance most is the moment they cannot get it.

Root cause is architectural: guidance and shelter data are fetched from a server at the moment of crisis. Any design that depends on the network at alert time will fail in exactly the scenarios it exists for.

## 2. Product promise

> Everything you need in an emergency is already on your phone. Priedanga works with full network, with a congested network, and with no network at all.

Three design rules follow from this:

1. **Zero network at the moment of crisis.** Shelters, maps, guidance and alert templates are preloaded and kept fresh in quiet times.
2. **Only signed alerts are shown as alerts.** Every alert is cryptographically signed by the issuing authority and verified on the device, whatever path it arrived by (push, mesh, test).
3. **No accounts, no location upload.** The phone decides locally whether an alert applies to it. Nothing about the user leaves the device.

## 3. Relationship to the state

- **Lithuania already has a cell-broadcast warning system** (Gyventojų perspėjimo ir informavimo sistema, run by PAGD since 2012). Priedanga does **not** replace it. Cell broadcast stays the primary alarm; Priedanga is what people open next: what to do, where to go, how to stay informed if the network drops.
- **Alert authority stays with the state.** Priedanga is a delivery and guidance system. It never authors real alerts itself. Until a formal agreement exists, only clearly labelled TEST/DEMO alerts are issued.
- **Likely customer:** PAGD under the Ministry of the Interior (VRM), which operates LT72 today. Secondary: municipalities, KAM / Riflemen's Union for exercises.
- **No impersonation.** No state symbols, no "official" wording until adoption.

## 4. Target users

| User | Need | Design implication |
|---|---|---|
| General public (~2.8M) | Know what to do and where to go, fast | One-tap shelter finder, huge text, no login |
| Elderly / low digital literacy | Calm, simple instructions | Large type, voice readout, minimal screens |
| Russian, Polish, Ukrainian, English speakers | Instructions in their language | 5 languages offline: LT, EN, RU, PL, UK |
| Deaf / hard of hearing | Notice an alert without sound | Strong vibration pattern, flashing screen |
| Blind / low vision | Use it with a screen reader | Full VoiceOver / TalkBack support |
| Issuing authority (PAGD, municipalities) | Send a trustworthy alert quickly, without mistakes | Issuer console with templates, preview, two-person approval |

## 5. MVP features (Phase 1)

The MVP has to be demoable to PAGD/VRM and survive a real blackout test.

### 5.1 Citizen app (Android + iOS)

| # | Feature | Notes |
|---|---|---|
| A1 | **Offline shelter finder** | Shelters, collective protection structures (KAS), evacuation points and sirens from the PAGD open registers; GPS (works without cellular); nearest-N list with distance and bearing; compass arrow; **offline walking route**; search by address or name; manual municipality or address pick if GPS is unavailable or spoofed |
| A2 | **Offline map** | Vector map of the user's region downloaded at onboarding (~10–30 MB); full-country pack optional. **Built (dev):** region packs (PMTiles extract of the Protomaps OSM build + walking network) signed with the content key; MapLibre map with shelters, your position and offline walking routes (A*). Regions: Kaunas 16 MB, Vilnius 27 MB. **On-demand downloads built:** region index, Offline maps screen (your area highlighted, progress, update, delete), verify-then-swap install (tampered file rejected, old copy kept). Still open: hosting (CDN), all-Lithuania coverage, production OSM pipeline (Geofabrik instead of Overpass), resumable downloads |
| A3 | **Offline guidance library** | What to do for each alert type (air attack, chemical, radiation, flood, etc.), in 5 languages, with large type and voice readout via the OS's offline text-to-speech. **Built (draft):** 8 emergency topics in `content/guidance`, written from PAGD / SAM / RSC guidance with cited sources, shipped in the signed pack, linked from alerts. Needs PAGD review; RU/PL/UK need native review. Read-aloud only appears where the OS has a voice (iOS has none for Lithuanian) |
| A4 | **Signed alerts via push** | One payload carries the full alert; no fetch needed to show it; verified on the device before display |
| A5 | **Local area filtering** | Alerts are sent to every device; the phone shows them only if its municipality or area matches. No location leaves the phone |
| A6 | **Loud alerts that get through** | Android: high-priority channel that can break through Do Not Disturb, full-screen alert. iOS: Critical Alerts entitlement (apply to Apple; needs a public-safety justification) |
| A7 | **Alert status screen** | Current level (mirrors the official air-alert levels: yellow, red, yellow after red, white), area, issuer, time, how it arrived (push / mesh, hop count) |
| A8 | **"No network" mode** | Detects loss of connectivity and switches the home screen to the offline essentials: nearest shelter, guidance, mesh status, LRT radio frequencies for your area |
| A9 | **Freshness indicator** | Shows when shelter data and content were last updated, and warns if it is stale |
| A10 | **Accessibility baseline** | Dynamic type, screen readers, high contrast, vibration pattern for deaf users |
| A11 | **Tiltas mesh v0** | Phones relay signed alerts to nearby phones over Bluetooth LE. See §6 for the honest limits. **Built (iOS + Android, untested on radio):** protocol v1 ([SPEC](../packages/tiltas/SPEC.md)), CoreBluetooth engine, verify-before-relay in the app, home switch with auto-on during alerts/offline, mesh alerts labelled. Still open: over-the-air tests (Pixel/iPhone + Mac peer, then mixed phones), native background verification, revocations over the mesh |
| A12 | **Preparedness checklist** | Offline 72-hour kit checklist, stored locally. **Built (draft):** go-bag, 72 h home supplies (water scales with household size), family plan, before leaving; from PAGD pages; ticks saved on the phone |
| A13 | **Offline first aid** | Bleeding, unconsciousness, CPR (with metronome), burns; 112 shortcut with tourniquet timer. Table stakes since Budrus ships it (see [competitive/budrus.md](competitive/budrus.md)). **Built (draft):** CPR, severe bleeding, recovery position, burns, choking (ERC 2025), CPR metronome (110/min, compressions-only or 30:2, haptics, screen kept awake), tourniquet timer that survives app restarts. Needs medical review |
| A14 | **Siren coverage** | Using the official siren sound radius: tell users "you may not hear a siren here — keep alerts on" |
| A15 | **Alert history** | Past alerts with timeline and duration; seeded from the official PAGD warning-message archive |

### 5.2 Issuer console (web, for authority / demo)

| # | Feature | Notes |
|---|---|---|
| C1 | Compose alert from templates | Type, level, area (municipalities), optional free text in each language |
| C2 | Preview | Exactly what the phone will show, in all languages |
| C3 | Two-person approval | One person drafts, a second approves; signing happens only after approval |
| C4 | Hardware-backed signing | Issuer key never leaves an HSM or a hardware security key |
| C5 | Test vs live separation | TEST alerts are visually distinct on the phone and use a separate key |
| C6 | Audit log | Append-only record of who drafted, approved and sent what, and when |

### 5.3 Content pipeline

| # | Feature | Notes |
|---|---|---|
| P1 | Content packs | Shelters, guidance, templates and map tiles published as versioned static files |
| P2 | Signed manifest | The app accepts a pack only if the manifest signature verifies |
| P3 | Multi-CDN | Packs mirrored to at least two independent CDNs; any one can disappear |
| P4 | Delta updates | Small daily diffs, so keeping data fresh costs almost nothing |

## 6. Tiltas (mesh) — what is realistic in the MVP

Mesh relaying is the hardest part and the platforms constrain it. The MVP is honest about this.

- **Android:** a foreground service can scan, advertise and relay continuously. Full relay node.
- **iOS:** Apple restricts Bluetooth activity when the app is in the background or the phone is locked (Multipeer Connectivity stops entirely; CoreBluetooth still works but is slow and throttled). iPhones receive and relay reliably while Priedanga is open, and opportunistically in the background.
- **Implication:** in a blackout the Android population carries the mesh, and iPhones pick alerts up when opened. The app tells users "keep Priedanga open during an outage to help relay alerts".
- **Payload:** alerts are tiny (template ID + area + level + signature, ~130 bytes), so one short Bluetooth exchange is enough. Free text is optional and relayed only if it fits.
- **Safety:** phones relay only alerts with a valid signature, with a hop limit and deduplication, so the mesh cannot be flooded or used to spread fake alerts.

## 7. Explicitly out of scope for the MVP

- User accounts, profiles, chat between users
- Uploading user location or any telemetry beyond opt-in crash reports
- Family "I'm safe" check-in (Phase 2)
- Community shelter photos and info (Phase 2, see [ideas-backlog.md](ideas-backlog.md) I-1)
- Sightings reports with media (Phase 2–3, see [ideas-backlog.md](ideas-backlog.md) I-2)
- Drone detection and sensor fusion (separate product line)
- Replacing or controlling cell broadcast or sirens
- Authoring real alerts without a formal agreement with the authority

## 8. Success criteria for the MVP demo

1. **Blackout test:** with airplane mode on, a phone shows the nearest shelters, the route bearing, and the full guidance in all 5 languages.
2. **Load test:** 3 million simulated devices receive an alert; no server is in the read path, so origin load is effectively zero.
3. **Mesh test:** an alert injected into one Android phone reaches 10 other phones (mixed Android/iOS, foreground) within 60 seconds, with no network.
4. **Forgery test:** a forged or modified alert is rejected on every path (push, mesh, content pack).
5. **Accessibility test:** core flows usable with VoiceOver and TalkBack, and by at least 5 elderly test users without help.

## 9. Phases

| Phase | Content |
|---|---|
| **1 — MVP** | Everything in §5, test issuer only, pilot with a small user group |
| **2 — Pilot** | iOS mesh improvements, SMS fallback, family check-in, community shelter info (I-1), private sightings pilot (I-2), external penetration test, accessibility audit, pilot with one municipality |
| **3 — Integration** | CAP feed integration with PAGD's warning system, production issuer keys held by the authority, sightings routed to authorities, state-approved hosting, national rollout |

## 10. Open questions

1. ~~**Shelter data source.**~~ **Resolved 2026-10-18:** PAGD publishes shelters, KAS, sirens, evacuation points and the warning-message archive as open data (CC BY 4.0) via `get.data.gov.lt`. See [competitive/budrus.md](competitive/budrus.md) §6.
2. **Official alert-level semantics.** Exact meaning and wording of yellow / red / yellow-after-red / white must be confirmed with PAGD and mirrored exactly.
3. **When to approach PAGD.** Recommendation: after the blackout and load demos work, before Phase 2.
4. **iOS Critical Alerts.** Apple grants this entitlement case by case; a letter of support from an authority helps.
5. **Budget.** Apple/Google developer accounts, a hardware signing key, CDN and an external penetration test before any pilot.
