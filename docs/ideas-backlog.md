# Priedanga — Ideas Backlog

Living list of feature ideas. Each entry: the idea as given, then the design constraints that come with it, and a proposed phase. Ideas move into [mvp-scope.md](mvp-scope.md) once scoped.

**Rule for every idea here:** community and social features must never sit on the alert or shelter read path. The app must be fully usable in a blackout with all of them unavailable.

---

## I-1. Community shelter information

*Added 2026-10-18.*

**Idea:** users upload photos of shelters (entrances, signage, interior), descriptions and practical notes.

**Why it matters:** the hard part in a real alert is often not knowing *where* the shelter is, but finding the entrance, knowing whether it is open, and whether it is accessible. Ground-level photos solve this.

**Contribution types:**
- Entrance photo(s), with "how to find it" text ("door on the courtyard side, next to the bins")
- Status confirmations: "was open / locked on <date>", "sign missing"
- Accessibility: steps, wheelchair access, lighting, capacity estimate
- Corrections: wrong location, shelter no longer exists

**Design constraints:**
- **Moderation before publication.** Nothing user-uploaded is shown publicly until reviewed (human review queue, later assisted by automatic checks).
- **Strip metadata.** Remove EXIF (GPS, device, timestamps) from every photo on the device before upload.
- **Blur faces and number plates** automatically before publication.
- **Sensitive sites.** Some shelters are in sensitive or critical buildings; the authority must be able to hide photos or entire entries.
- **Offline-first delivery.** Approved photos are downscaled (~50 KB) and shipped inside the regional content pack, so they are available in a blackout.
- **Queued uploads.** Contributions are saved locally and sent when a network is available.

**Proposed phase:** 2 (pilot).

---

## I-2. Sightings reports (aerial and other)

*Added 2026-10-18.*

**Idea:** users report sightings (drones, balloons, aircraft, missiles, explosions, other) with video, audio, photos, location, time and a description.

**Why it matters:** Ukraine's ePPO app showed that citizen reports can add useful early-warning signal, especially for low, slow objects that radar struggles with. Audio is particularly valuable (e.g. the distinctive engine sound of some attack drones) and links directly to a future acoustic-detection product.

**Design constraints — these are important:**
- **Not a public feed.** Real-time public posting of sightings helps an adversary: it reveals where objects were seen, whether they got through, and where air defence is. Reports go to a private review pipeline and, once an agreement exists, to the authorities. The public sees only authority-approved, delayed or aggregated information.
- **Requires a recipient.** Without a defined receiving authority (PAGD, police, armed forces), reports have nowhere responsible to go. Until then: pilot only, with no public visibility.
- **Fake-report resistance.** Expect hostile mass submissions meant to cause panic or swamp operators. Mitigations: rate limits, device attestation (Play Integrity / App Attest), contributor reputation, and corroboration (several independent reports close in time and place before anything is escalated).
- **Reporter safety first.** The app must never encourage people to go outside to film during an active alert; the report button shows "go to shelter first" during red alerts.
- **Privacy.** Strip EXIF from media; location is attached only as an explicit report field with consent; reporters are pseudonymous to the public.
- **Legal check needed.** Filming certain military objects or activity may be restricted under Lithuanian law; confirm before launch.
- **Network.** Media uploads need connectivity and are queued until available. A text-only report (type, time, location, direction) is small enough to relay over the Tiltas mesh later.

**Proposed phase:** 2 (private pilot), 3 (with an authority receiving reports).

---

## Impact on existing principles

- **"No accounts"** becomes **"no accounts needed"**: reading, alerts and shelters stay anonymous; contributing may use an optional pseudonymous account (needed for reputation and abuse control).
- **"No location upload"** stays true for passive use. Location is uploaded only when the user explicitly submits a report or contribution.
- A backend with media storage and a moderation queue is added. It is separate from the alert and content infrastructure and can fail without affecting them.

---

## I-3. Relay mode for official alerts

*Added 2026-10-18, from the [Budrus analysis](competitive/budrus.md).*

**Idea:** before any agreement with the state, show real official alerts. Priedanga's server reads the official PAGD warning feed and signs each message with a dedicated **relay** certificate.

**Why it matters:** competitors already show real alerts today; an app that shows only TEST alerts is not useful to people yet.

**Design constraints:**
- **Honest provenance.** The phone labels relayed alerts as "Relayed from PAGD by Priedanga — not signed by PAGD", visually distinct from authority-signed alerts.
- **New certificate role** in the alert format (e.g. `Relay`), with its own reason codes and test vectors. This is a v1 spec change and must be made before any native port.
- **Verbatim text only.** No AI rewriting or summarising; official text and area description as published.
- **Latency.** Measure how quickly the open-data feed updates compared with cell broadcast; if it lags, say so in the UI.
- **Mesh.** Relayed alerts are signed, so they travel over Tiltas like any other alert.

**Proposed phase:** 1 (MVP), if the feed latency turns out acceptable.
