#!/bin/bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo 'Usage: verify-macos-artifact.sh DMG ARCH VERSION' >&2
  exit 64
fi

dmg=$1
arch=$2
version=$3
case "$arch" in arm64|x64) ;; *) echo "Unsupported architecture: $arch" >&2; exit 64 ;; esac
test -f "$dmg"
hdiutil verify "$dmg"

mountpoint=$(mktemp -d "${TMPDIR:-/tmp}/vhostra-dmg.XXXXXXXX")
attached=0
cleanup() {
  if [ "$attached" -eq 1 ]; then hdiutil detach "$mountpoint" -quiet; fi
  rmdir "$mountpoint"
}
trap cleanup EXIT
hdiutil attach -readonly -nobrowse -quiet -mountpoint "$mountpoint" "$dmg"
attached=1

app="$mountpoint/Vhostra.app"
exe="$app/Contents/MacOS/Vhostra"
cli="$app/Contents/Resources/bin/vhostra"
test -d "$app/Contents/Frameworks/Electron Framework.framework"
test -f "$app/Contents/Resources/app.asar"
test -x "$exe"
test -x "$cli"
expected_arch=$arch
if [ "$arch" = x64 ]; then expected_arch=x86_64; fi
test "$(lipo -archs "$exe")" = "$expected_arch"
test "$(lipo -archs "$app/Contents/Frameworks/Electron Framework.framework/Electron Framework")" = "$expected_arch"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")" = "$version"

codesign --verify --deep --strict --verbose=2 "$app"
codesign --verify --strict --verbose=2 "$app/Contents/Frameworks/Electron Framework.framework"
for helper in "$app"/Contents/Frameworks/Vhostra\ Helper*.app; do
  codesign --verify --strict --verbose=2 "$helper"
done
signature=$(codesign -dv --verbose=4 "$app" 2>&1)
case "$signature" in *'Signature=adhoc'*) ;; *) echo 'Expected a consistently ad hoc signed app.' >&2; exit 1 ;; esac

# Ad hoc signing repairs bundle consistency; it does not grant Gatekeeper trust.
if spctl --assess --type execute --verbose=4 "$app"; then
  echo 'Gatekeeper accepted the app unexpectedly; review its signing identity.'
else
  echo 'Gatekeeper rejected this ad hoc signed, unnotarized app as expected.'
fi
if xattr -p com.apple.quarantine "$dmg" >/dev/null 2>&1; then
  echo 'Downloaded DMG carries quarantine.'
else
  echo 'DMG has no quarantine attribute in this build environment.'
fi
echo "Verified macOS $arch DMG integrity, bundle, architecture, permissions, and nested signatures."
