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
cd apps/mobile/modules/tiltas/ios && swift run tiltas-peer --offers /tmp/offers.json
```

The first run of `tiltas-peer` asks macOS for Bluetooth access for the terminal app.

**On the phone:** turn on Bluetooth, put the phone in airplane mode with Bluetooth back on (so the alert can only arrive over Tiltas), open Priedanga, turn on the Tiltas switch, allow Bluetooth access.

**Expected:**

1. Within about 30 s the phone shows the red TEST alert with "Gauta per Tiltas iš kito telefono. Parašas patikrintas šiame telefone."
2. The Tiltas card shows phones met ≥ 1 and alerts shared = 1.
3. Reverse direction: stop `tiltas-peer` (Ctrl-C) and start it again without offers (`swift run tiltas-peer`). It fetches the alert from the phone and prints it (`received ... bytes`); the last byte of the envelope is the hop count, now 2.
4. With the screen locked, the notification "Tiltas – perdavimas be interneto" stays, and the Mac keeps seeing the phone.

Useful log: `adb logcat -s Tiltas`.

**Forgery check:** edit one hex character inside the `envelope` in `/tmp/offers.json` (in the text part, not the length bytes), restart `tiltas-peer`. The phone must not show the alert; logcat shows the session, and the alert is not fetched again for an hour.

## Test 2: mixed phones

Two or more phones (Android and iPhone dev builds), no Mac peer. Seed one phone from the online feed (Wi-Fi on), put the others in airplane mode with Bluetooth on. Measure the time until every phone shows the alert. Then move the seeded phone out of range and check that the alert keeps spreading from the phones that received it.

## What to record

- Time to first receipt, per phone
- Phone models and OS versions
- Screen on/off, app open/backgrounded
- Any session failures in the logs
