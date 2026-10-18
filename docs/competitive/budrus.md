# Competitive analysis: Budrus

Researched: 2026-10-18. Sources: App Store and Google Play listings, Budrus privacy policy, data.gov.lt.

## 1. Snapshot

| | |
|---|---|
| Maker | Mygom.tech MB (Lithuanian software company), run as a non-profit initiative |
| Launched | 2026-09-22 (about 4 weeks ago); now v1.3 |
| Platforms | iOS (16.4+) and Android (package `tech.mygom.lt73`, a nod to LT72) |
| Ratings | iOS 5.0 from 6 ratings; Android 4.9 from 7 reviews, 100+ installs |
| Languages | Lithuanian, English |
| Size | ~203 MB on iOS (offline base map bundled) |
| Price | Free, no in-app purchases |
| Privacy | "Data Not Collected"; location stays on the device; no analytics SDKs |
| Positioning | Independent information app that supplements, not replaces, official warnings |

**About the "great reviews":** the scores are excellent, but they come from 13 ratings in total and 100+ Android installs. It is a strong, fast-moving product with a very small user base so far. The market is not taken.

## 2. What Budrus has

**Alerts and status**
- Alerts from public sources for municipalities the user picks, showing when each source was last checked and whether it is reachable.
- Push via Firebase topics per municipality (e.g. `sav-13`); since v1.3, important notifications break through Do Not Disturb.
- A "Ramu" (calm) status when monitored sources show no active warnings.
- Event history with durations and timelines, linked to sources.

**Map and shelters**
- Shelters, collective protection structures (KAS), evacuation points and sirens, from the PAGD / State Data Agency registers (CC BY 4.0).
- Search by city, street or name; place details; walking route to a shelter, calculated offline (Valhalla on OpenStreetMap).
- Offline base map (OpenFreeMap / OpenStreetMap).
- Car mode with evacuation points; navigation hands off to Apple Maps.

**News**
- Aggregated news from lt72.lt, LRT, Delfi, 15min, Lrytas and TV3, with AI-generated summaries; kept for 72 hours.
- Embedded LRT live broadcast.

**Preparedness and first aid (offline)**
- First-aid guides: bleeding, unconsciousness, CPR with a metronome and timers, burns.
- 112 emergency bar with a tourniquet timer.
- Training mode, printable card, packing list.
- Four-step setup wizard.

## 3. What Budrus does not have

| Gap | Why it matters |
|---|---|
| **No verification of alerts** | Alerts are relayed from public sources through Budrus's own server and Firebase. Nothing on the phone proves an alert is genuine; a compromised server or account could push a fake one. |
| **No blackout delivery** | If the internet or Budrus's server is down, no new alerts arrive. No mesh, no peer-to-peer relay. |
| **Single delivery chain** | Public JSON on one origin behind Cloudflare, plus Firebase. Every alert depends on that chain working at the worst moment. |
| **Admitted delay** | The listing itself warns that public-source information can be late or incomplete. Polling a source and re-pushing adds latency on top of the official channel. |
| **AI summaries in a crisis** | The listing warns summaries may contain errors. In an emergency, a wrong summary is worse than none. |
| **Only Lithuanian and English** | No Russian, Polish or Ukrainian, which leaves out large minorities and refugees. |
| **No issuer side** | Budrus is a consumer-side aggregator. It cannot become the authority's own trusted channel: no issuer console, no signing, no approval workflow. |
| **No community data** | Users cannot add entrance photos or report "locked / open". The official register is thin: only about 22% of shelters (1,416 of 6,583) have lighting information, for example. |
| **No sightings reporting** | Nothing like Ukraine's ePPO. |
| **Accessibility not stated** | No mention of screen readers, deaf users, large text or elderly-first design. |
| **Heavy install** | ~203 MB is a lot for old or low-storage phones, which elderly users often have. |
| **Car mode needs a network** | Navigation is handed off to Apple Maps. |

## 4. Where Priedanga has to be better — and where it only has to match

### Must match (table stakes Budrus already set)
- Offline shelter map with search and **offline walking route**
- Shelters + KAS + evacuation points + sirens from the official registers
- Do Not Disturb breakthrough
- Offline first aid (including CPR metronome, tourniquet timer)
- Packing list / preparedness checklist, setup wizard
- Alert history
- LRT broadcast access
- No data collection by default

### Win decisively (things Budrus structurally cannot do without a rebuild)
1. **Signed, verifiable alerts.** Every alert is checked on the phone against a pinned root key (built: `packages/alert-format`). This is the basis for the state trusting it as an official channel.
2. **Works in a blackout.** Tiltas relays signed alerts phone to phone over Bluetooth. Forged alerts are dropped at the first phone.
3. **Five languages offline:** LT, EN, RU, PL, UK.
4. **Issuer console for the authority:** templates, preview, two-person approval, hardware-key signing, audit log. Budrus has to scrape sources; Priedanga can become the source's own channel.
5. **Community shelter layer** (backlog I-1): entrance photos, "open/locked" confirmations, accessibility details. This fills the gaps in the official register and ships inside the offline pack.
6. **Private sightings pipeline** (backlog I-2), corroborated and routed to authorities, not a public feed.
7. **Accessibility first:** elderly, blind and deaf users as primary design targets.
8. **Smaller install:** regional map packs downloaded on demand instead of one large bundle.

### Deliberately not copied
- **AI news summaries during alerts.** Too risky in a crisis. If news is shown at all, it should be verbatim official text plus links.

## 5. Strategic notes

- **Budrus moves fast.** v1.0 to v1.3 in three days, with a large feature drop in 1.1. Expect them to add languages and accessibility. Our durable advantages are the ones that need a different architecture: signatures, mesh and the issuer side.
- **Real alerts today.** Budrus shows real alerts now; Priedanga's MVP only shows signed TEST alerts. To be useful before a state agreement, consider a **relay mode**: Priedanga's server reads the official PAGD feed and signs each message with a separate *relay* certificate. The app would label these "Relayed from PAGD by Priedanga — not signed by PAGD". That's honest provenance, and it still travels over the mesh. It would need a new certificate role in the alert format (backlog I-3).
- **Same buyer, different model.** Budrus is free and non-profit; we aim to sell to the state. To the ministry, the pitch is not "a nicer app" but "the authority's own verified, blackout-proof channel, plus an issuer console".
- **Collaboration is an option.** The alert format and Tiltas could be published as an open protocol that Budrus (and LT72) could adopt. That would make Priedanga's trust core the national standard even if several apps exist. Worth deciding before the first conversation with PAGD.

## 6. Bonus finding: official open data

The research also answered open question 1 in [mvp-scope.md](../mvp-scope.md). PAGD publishes these datasets on data.gov.lt via the `get.data.gov.lt` API (CC BY 4.0):

| Dataset | API path | Rows (2026-10-18) | Notes |
|---|---|---|---|
| Shelters (priedangos) | `datasets/gov/pagd/priedangos/Priedanga` | 6,583 | Address, WGS84 point, capacity, area, operator, lighting/sanitation/ventilation (often empty), accessibility, photo flag, last update |
| Collective protection structures (KAS) | `datasets/gov/pagd/kas/KAS` | 2,517 | Similar fields, opening hours, 24/7 access |
| Sirens | `datasets/gov/pagd/sirenos/Sirena` | 1,180 | Location, address, **sound radius** |
| Evacuation points | `datasets/gov/pagd/evakuacijos_punktai/EvakuacijosPunktas` | — | Assembly points |
| Warning messages | `datasets/gov/pagd/pranesimai/Pranesimas` | 1,160 | Cell-broadcast messages since 2012: text, area description, start/end time, source (e.g. KOP = armed forces). Includes the 2026-09-15 drone alerts (yellow → white) |

The siren sound radius makes it possible to show "you may not hear a siren here", a feature neither LT72 nor Budrus offers.
