#!/bin/sh
# Build tiltas-peer as a minimal macOS app bundle and print how to run it.
#
# macOS kills a command-line tool that uses Bluetooth unless the *responsible
# app* (the terminal or IDE that launched it) declares a Bluetooth usage text.
# Launching a bundle through `open` makes the peer its own app with its own
# Bluetooth permission prompt.
set -e
cd "$(dirname "$0")/.."
swift build -c release --product tiltas-peer
APP=.build/TiltasPeer.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp .build/release/tiltas-peer "$APP/Contents/MacOS/"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>tiltas-peer</string>
  <key>CFBundleIdentifier</key><string>com.balticbot.tiltas-peer</string>
  <key>CFBundleName</key><string>Tiltas Peer</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>LSUIElement</key><true/>
  <key>NSBluetoothAlwaysUsageDescription</key><string>Tiltas Peer exchanges signed test alerts with nearby Priedanga phones.</string>
</dict>
</plist>
PLIST
codesign --force --sign - "$APP"
echo "Built $PWD/$APP"
echo "Run:  open -n $APP --stdout /tmp/tiltas-peer.log --stderr /tmp/tiltas-peer.log --args --offers /tmp/offers.json && tail -f /tmp/tiltas-peer.log"
echo "Stop: pkill -f TiltasPeer.app"
