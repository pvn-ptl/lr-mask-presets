#!/bin/bash
# Check the disk image the way someone who downloads it gets it: mount it read-only, check what's inside (the app, its
# signature, both architectures, the version, the Applications shortcut), run the app's self-test from the image,
# and detach. Also reports what Gatekeeper will say about it on another Mac.
#   scripts/verify-dmg.sh [dist/LR-Mask-Presets.dmg]
set -euo pipefail
cd "$(dirname "$0")/.."

DMG="${1:-dist/LR-Mask-Presets.dmg}"
NAME="LR Mask Presets"
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)
fail() { echo "FAIL: $*" >&2; exit 1; }

[[ -f "$DMG" ]] || fail "$DMG not found (run scripts/build-mac-app.sh first)"
hdiutil verify -quiet "$DMG" || fail "the image's checksum doesn't verify"
[[ "$(hdiutil imageinfo "$DMG" | sed -n 's/^Format: //p')" == "UDZO" ]] || fail "not a compressed read-only image"

MNT=$(mktemp -d "${TMPDIR:-/tmp}/lrmask-verify.XXXXXX")
cleanup() { hdiutil detach -quiet "$MNT" 2>/dev/null || hdiutil detach -quiet -force "$MNT" 2>/dev/null || true; rmdir "$MNT" 2>/dev/null || true; }
trap cleanup EXIT
hdiutil attach -quiet -readonly -nobrowse -noautoopen -mountpoint "$MNT" "$DMG"

APP="$MNT/$NAME.app"
[[ -d "$APP" ]] || fail "no $NAME.app on the image"
[[ -L "$MNT/Applications" && "$(readlink "$MNT/Applications")" == "/Applications" ]] || fail "no Applications shortcut"
[[ -f "$MNT/.VolumeIcon.icns" ]] || fail "no volume icon"
EXTRA=$(cd "$MNT" && ls -A | grep -v -x -e "$NAME.app" -e Applications -e .VolumeIcon.icns -e .fseventsd -e .Trashes || true)
[[ -z "$EXTRA" ]] || fail "unexpected files on the image: $EXTRA"
codesign --verify --strict --deep "$APP" || fail "the app's signature doesn't verify"
ARCHS=$(lipo -archs "$APP/Contents/MacOS/$NAME")
[[ "$ARCHS" == *arm64* && "$ARCHS" == *x86_64* ]] || fail "expected arm64 and x86_64, got $ARCHS"
[[ "$(plutil -extract CFBundleShortVersionString raw "$APP/Contents/Info.plist")" == "$VERSION" ]] || fail "version isn't $VERSION"
[[ "$(plutil -extract LSMinimumSystemVersion raw "$APP/Contents/Info.plist")" == 13.0* ]] || fail "minimum macOS isn't 13"
# Nothing private or unfinished on board: no converted presets, no source maps, no stray macOS files.
LEAKS=$(find "$APP" \( -name '*.xmp' -not -path '*/web/samples/*' -o -name '*.lrtemplate' -not -path '*/web/samples/*' -o -name '*.map' -o -name '.DS_Store' -o -path '*/output/*' \) -print)
[[ -z "$LEAKS" ]] || fail "unexpected files in the app: $LEAKS"

"$APP/Contents/MacOS/$NAME" --selftest || fail "the self-test failed when run from the image"

echo "Gatekeeper on another Mac (expected: rejected until the app is notarized; see README › Install):"
spctl --assess --type execute -vv "$APP" 2>&1 | sed 's/^/  /' || true
echo "OK: $DMG ($(du -h "$DMG" | cut -f1 | tr -d ' '), $ARCHS, version $VERSION), sha256 $(shasum -a 256 "$DMG" | cut -d' ' -f1)"
