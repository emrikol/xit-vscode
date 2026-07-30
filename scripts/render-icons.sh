#!/bin/sh
#
# Render the icon sources in assets/ to the PNGs that package.json points at.
#
# The PNGs are committed, so this only needs running when an SVG changes.
# VS Code will not take an SVG for the extension icon, and the Marketplace
# rejects one outright, so a raster step is unavoidable.
#
# Needs librsvg:  brew install librsvg

set -e

if ! command -v rsvg-convert >/dev/null 2>&1; then
	echo "render-icons: rsvg-convert not found." >&2
	echo "              install it with: brew install librsvg" >&2
	exit 1
fi

here=$(dirname "$0")
assets="$here/../assets"

# At least 128x128, and 256x256 for retina, per the extension manifest
# reference. One 256x256 file satisfies both.
rsvg-convert -w 256 -h 256 "$assets/icon.svg" -o "$assets/icon.png"

# File icons are drawn small in the explorer and the tab bar.
rsvg-convert -w 64 -h 64 "$assets/file-icon-dark.svg" -o "$assets/file-icon-dark.png"
rsvg-convert -w 64 -h 64 "$assets/file-icon-light.svg" -o "$assets/file-icon-light.png"

echo "render-icons: wrote icon.png, file-icon-dark.png, file-icon-light.png"
