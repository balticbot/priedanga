# Tiltas field test

How to test the Tiltas Bluetooth mesh with real radios. The iOS Simulator has no Bluetooth, so at least one physical phone is needed.

## Test 1: Android phone + Mac peer

The Mac acts as a second Tiltas phone (`tiltas-peer`, CoreBluetooth). It serves a signed TEST alert and prints whatever it fetches back.

**Build and install** (Mac):

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=~/Library/Android/sdk
cd apps/mobile && npx expo prebuild -p android && cd android && ./gradlew assembleRelease
~/Library/Android/sdk/platform-tools/adb install -r app/build/outputs/apk/release/app-release.apk
```

The phone needs USB debugging (Settings → About phone → tap Build number 7 times → Developer options → USB debugging), connected by cable.

**Seed** (Mac, two terminals). The demo alert is nationwide and expires after 30 minutes; regenerate the offers if the test runs longer.

```bash
npm run relay -- serve --days 60 --demo red
npm run offers -w @priedanga/tiltas > /tmp/offers.json
apps/mobile/modules/tiltas/ios/Peer/make-app.sh      # builds .build/TiltasPeer.app and prints the run command
cd apps/mobile/modules/tiltas/ios
open -n .build/TiltasPeer.app --stdout /tmp/tiltas-peer.log --stderr /tmp/tiltas-peer.log --args --offers /tmp/offers.json
tail -f /tmp/tiltas-peer.log
```

The peer runs as a small app bundle because macOS kills a command-line tool that uses Bluetooth unless the app that launched it declares a Bluetooth usage text (`swift run tiltas-peer` crashes with a TCC privacy violation when started from an IDE or agent). The first launch asks for Bluetooth access for "Tiltas Peer". The Mac's Bluetooth must be on. Stop it with `pkill -f TiltasPeer.app`.

**On the phone:** turn on Bluetooth, put the phone in airplane mode with Bluetooth back on (so the alert can only arrive over Tiltas), open Priedanga, turn on the Tiltas switch, allow Bluetooth access.

**Expected:**

1. Within about 30 s the phone shows the red TEST alert with "Gauta per Tiltas iš kito telefono. Parašas patikrintas šiame telefone."
2. The Tiltas card shows phones met ≥ 1 and alerts shared = 1.
3. Reverse direction: stop the peer and start it again without `--args --offers ...`. It fetches the alert from the phone and prints it (`received ... bytes`); the last byte of the envelope is the hop count, now 2.
4. With the screen locked, the notification "Tiltas – perdavimas be interneto" stays, and the Mac keeps seeing the phone.

Useful log: `adb logcat -s Tiltas`.

**Forgery check:** edit one hex character inside the `envelope` in `/tmp/offers.json` (in the text part, not the length bytes), restart `tiltas-peer`. The phone must not show the alert; logcat shows the session, and the alert is not fetched again for an hour.

## Test 2: mixed phones

Two or more phones (Android and iPhone dev builds), no Mac peer. Seed one phone from the online feed (Wi-Fi on), put the others in airplane mode with Bluetooth on. Measure the time until every phone shows the alert. Then move the seeded phone out of range and check that the alert keeps spreading from the phones that received it.

## Results

### 2026-10-18 — Pixel 8 (Android 17) + MacBook peer

Release APK from `feat/tiltas`; Pixel in airplane mode with Bluetooth on; Priedanga in the background most of the time (the phone was in a video call), so the foreground service carried it.

| Check | Result |
|---|---|
| Mac → Pixel | Pixel connected, read the inventory (1 missing) and fetched the alert in **1.7 s** (19:44:14.7 → 19:44:16.4) |
| Verified on the Pixel | Yes: a fresh Mac peer fetched the alert back from the Pixel with **hops 2** (seeded with hops 1); signed body byte-identical; signature verifies against the dev trust store |
| Pixel → Mac | Fetch in ~2 s |
| Forgery (one letter of the text changed) | Pixel fetched the forged copy (new content key), rejected it, and kept serving only the genuine alert |
| Background | All of the above ran with the app in the background |

Not yet checked: what the phone screen showed (not captured), screen-locked behaviour over time, iPhone over the air, mixed-phone spread timing.

## What to record

- Time to first receipt, per phone
- Phone models and OS versions
- Screen on/off, app open/backgrounded
- Any session failures in the logs
