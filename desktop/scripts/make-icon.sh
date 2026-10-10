#!/bin/sh
# build/icon.svg → build/icon.png → build/icon.icns (macOS sizes).
set -e
cd "$(dirname "$0")/.."
./node_modules/.bin/electron scripts/render-icon.cjs
SET=build/icon.iconset
rm -rf "$SET" && mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z $s $s build/icon.png --out "$SET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) build/icon.png --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o build/icon.icns
rm -rf "$SET"
echo "build/icon.icns"
