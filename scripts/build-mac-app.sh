#!/bin/bash
# Build "LR Mask Presets.app" (universal: Apple silicon + Intel) into dist/, plus a disk image and a .zip to share.
# Needs only the Xcode Command Line Tools (xcode-select --install).
#   scripts/build-mac-app.sh            release build
#   scripts/build-mac-app.sh --debug    debug build (Web Inspector enabled)
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)
BUILD=$(git rev-list --count HEAD 2>/dev/null || echo 1)
NAME="LR Mask Presets"
APP="dist/$NAME.app"
FLAGS=(-O)
if [[ "${1:-}" == "--debug" ]]; then FLAGS=(-Onone -g -D DEBUG); fi

rm -rf "$APP" build/swift
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" build/swift
SDK=$(xcrun --sdk macosx --show-sdk-path)

for ARCH in arm64 x86_64; do
  xcrun swiftc "${FLAGS[@]}" -swift-version 5 -sdk "$SDK" -target "$ARCH-apple-macos13.0" \
    -o "build/swift/$ARCH" macos/main.swift
done
lipo -create -output "$APP/Contents/MacOS/$NAME" build/swift/arm64 build/swift/x86_64

sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD/" macos/Info.plist > "$APP/Contents/Info.plist"
cp macos/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
mkdir -p "$APP/Contents/Resources/web"
# The web UI, minus anything that isn't part of the app.
(cd web && find . -type f ! -name '.DS_Store' -print0 | while IFS= read -r -d '' f; do
  mkdir -p "../$APP/Contents/Resources/web/$(dirname "$f")"
  cp "$f" "../$APP/Contents/Resources/web/$f"
done)

# Ad-hoc signature: enough for the app to run here and on Apple silicon; see README for Gatekeeper.
codesign --force --sign - --timestamp=none "$APP"
codesign --verify --strict "$APP"

ZIP="dist/LR-Mask-Presets-$VERSION-macOS.zip"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"

# The disk image people download: the app beside a shortcut to Applications, to drag it across, with the app's icon
# on the volume. Its name doesn't change between versions, so the README can link to the latest release's copy.
DMG="dist/LR-Mask-Presets.dmg"
STAGE=build/dmg
RW=build/dmg-rw.dmg
rm -rf "$STAGE" "$RW" "$DMG"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/$NAME.app"
ln -s /Applications "$STAGE/Applications"
cp macos/AppIcon.icns "$STAGE/.VolumeIcon.icns"
hdiutil create -quiet -volname "$NAME" -srcfolder "$STAGE" -fs HFS+ -format UDRW -ov "$RW"
MNT=$(mktemp -d "${TMPDIR:-/tmp}/lrmask-dmg.XXXXXX")
hdiutil attach -quiet -readwrite -nobrowse -noautoopen -mountpoint "$MNT" "$RW"
SetFile -a C "$MNT" 2>/dev/null || xcrun SetFile -a C "$MNT" 2>/dev/null || echo "note: SetFile not found; the volume keeps the generic icon"
hdiutil detach -quiet "$MNT" || hdiutil detach -quiet -force "$MNT"
rmdir "$MNT" 2>/dev/null || true
hdiutil convert -quiet "$RW" -format UDZO -imagekey zlib-level=9 -o "$DMG"
rm -rf "$STAGE" "$RW"

echo "Built $APP ($(lipo -archs "$APP/Contents/MacOS/$NAME")), $DMG and $ZIP"
