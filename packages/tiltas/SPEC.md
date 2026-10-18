# Tiltas mesh protocol — v1

Tiltas carries signed Priedanga alerts (see `packages/alert-format/SPEC.md`) from phone to phone over Bluetooth LE when there is no network. It is a transport only: it never makes an alert trustworthy. Every receiving phone verifies every alert before it shows, stores or relays it.

Status: **v1 draft**, implemented in TypeScript (`src/`, reference + simulation), Swift (`apps/mobile/modules/tiltas/ios`) and Kotlin (`apps/mobile/modules/tiltas/android`). All three pass the same vectors.

## 1. Principles

1. **Verify before relay.** A phone relays only alerts that passed full verification on that phone. A forged alert stops at the first phone.
2. **Content addressing.** An alert is identified on the mesh by its *key*: the first 8 bytes of SHA-256 over the envelope's `body` (the exact signed bytes). The `hops` counter is outside the body, so hop changes never create a second entry. A peer cannot announce a real alert's key with different content without a 64-bit second preimage.
3. **Plain BLE GATT.** No Multipeer Connectivity, no Nearby Connections, so iPhones and Android phones talk to each other.
4. **No identifiers.** No user or device IDs on the air. BLE addresses are randomised by the OS. Payloads are public alerts.
5. **Bounded everything.** Stored alerts, inbox, fetches per session, session time, retry cool-downs.

## 2. GATT layout

| Item | UUID | Properties |
|---|---|---|
| Service | `9E48E5B5-A636-4FC6-8312-05C46E541BEC` | advertised (primary) |
| `INVENTORY` | `A247668E-46A8-48A7-A7F7-9C774346DC20` | read |
| `SELECT` | `E6F3F542-B066-4CB9-B85D-01C4FA01E412` | write (with response) |
| `CHUNK` | `114CED89-DD83-444E-AF0B-C382940F1D4C` | read |

The advertisement carries only the service UUID (no local name). All multi-byte integers are big-endian. Every frame starts with the protocol version byte `0x01`; a receiver MUST reject any other version.

### 2.1 INVENTORY (read)

```
0x01 | count:u8 | count × entry
entry = key:8 | priority:u8 | expires:u32
```

- `count` ≤ 32, so the value is at most 418 bytes (one ATT long read; limit 512).
- `expires` is copied from the verified alert. `priority` is derived from it so peers fetch the most urgent alerts first: **3** level Red; **2** Yellow or YellowAfterRed; **1** White (all-clear) or a Cancel; **0** anything else.
- Entries are sorted by `priority` descending, then `expires` descending, then `key` ascending (bytewise). Keys are unique. Expired alerts are not listed.
- A receiver MUST reject the whole frame if its length is not exactly `2 + 13 × count`, `count` > 32, a key repeats, or `priority` > 3.

### 2.2 SELECT (write)

```
0x01 | key:8 | index:u8
```

Exactly 10 bytes. Selects chunk `index` of the alert with `key` for the next `CHUNK` read by this central. Selection state is per connected central.

### 2.3 CHUNK (read)

```
0x01 | index:u8 | total:u8 | payload
```

- The envelope is split into chunks of `CHUNK_PAYLOAD` = 480 bytes; `total` = ceil(length / 480), 1 ≤ `total` ≤ 3 (envelopes are at most 1024 bytes).
- `index` < `total`; every chunk but the last carries exactly 480 bytes; the last carries 1..480.
- If nothing is selected or the key is not held, the peripheral returns `0x01 | 0x00 | 0x00` (`total` = 0: not available).

### 2.4 Envelope check (transport level)

After reassembly, before handing an envelope to verification, the receiver checks:

1. length ≤ 1024;
2. it is a CBOR array of exactly 4 items `[uint, bstr, bstr(64), uint]` with definite, shortest-form lengths and nothing after it (the alert-format §5 envelope shape; full validation happens in verification);
3. SHA-256(`body`)[0..8] equals the requested key.

Any failure discards the data and puts the peer in the long cool-down (§3).

## 3. Sync session (central side)

1. **Scan** for the service UUID. Skip peers in cool-down: 60 s after a session, 300 s after a session with a protocol failure. One session at a time.
2. **Connect** (10 s timeout), discover the service and characteristics, read `INVENTORY`.
3. **Plan.** Missing = entries whose key the phone does not *hold* (served set ∪ inbox ∪ rejected) and whose `expires` is in the future. Same order as the inventory. At most 8 fetches per session.
4. **Fetch** each: write `SELECT(key, 0)`, read `CHUNK` → `total`; then `SELECT(key, i)` + read for i = 1..total-1. Reassemble; apply §2.4; add to the inbox.
5. **Disconnect.** Whole session limit 20 s.

## 4. Verification and relay (app side)

The inbox holds unverified envelopes and is never served to peers. The app drains it and, for each envelope:

1. runs alert-format verification at the current time (signature, certificate role and window, area scope, revocation, expiry, `hops` ≤ 16);
2. on success: shows the alert, stores it, and offers `withHops(envelope, hops + 1)` to the mesh with its `priority` and `expires`;
3. on failure: marks the key *rejected* (kept for 1 hour), so it is not fetched again from anyone. Because keys are content-addressed, rejecting a key cannot block a different, genuine alert.

An alert whose relayed copy would exceed `hops` 16 is shown but not offered.

## 5. Served set (peripheral side)

- At most 32 alerts. When full, expired alerts go first, then the lowest `priority`, then the earliest `expires`.
- The served set and the inbox (at most 16 envelopes) persist on the device, so a phone relaunched in the background can keep serving.

## 6. When it runs

- On while the user has Tiltas turned on, and automatically while a danger-level alert is active or the phone is offline (app decision, not protocol).
- **iOS:** full relay while the app is open. In the background CoreBluetooth keeps running but is throttled (slow scanning, service-UUID-only advertising); iPhones are mostly receivers while closed.
- **Android:** a foreground service (type `connectedDevice`, persistent notification) keeps scanning, advertising and serving with the screen off. Received alerts still wait for the app's JS to verify them before they are relayed.

## 7. Out of scope for v1

- Revocation messages over the mesh (planned: same transport, separate key space).
- Native (background) verification on iOS: received alerts wait in the inbox until the app runs. Relaying never waits on unverified data.
- CoreBluetooth state restoration (relaunch on BLE events after the app was terminated).

## 8. Test vectors

`test-vectors/frames.json` lists valid and invalid frames and envelope checks with expected results. The TypeScript, Swift and Kotlin implementations all run every vector.
