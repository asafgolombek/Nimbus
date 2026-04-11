#!/usr/bin/env bash
# Build a component .pkg for headless Nimbus (§7.9). Codesigning + notarization are release-time steps
# (see installers/README.md). CI may emit an unsigned pkg for smoke testing.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUNDLE="${1:-$ROOT/dist/headless-bundle}"
VERSION="${NIMBUS_RELEASE_VERSION:-0.0.0}"
VERSION="${VERSION#v}"
STAGE="$(mktemp -d)"
PKG_OUT="${2:-$ROOT/dist/installers/nimbus-headless-macos-x64-v${VERSION}.pkg}"

mkdir -p "$STAGE/usr/local/bin"
cp "$BUNDLE/nimbus-gateway" "$STAGE/usr/local/bin/"
cp "$BUNDLE/nimbus" "$STAGE/usr/local/bin/"
chmod 755 "$STAGE/usr/local/bin/nimbus-gateway" "$STAGE/usr/local/bin/nimbus"

mkdir -p "$(dirname "$PKG_OUT")"
pkgbuild \
  --root "$STAGE" \
  --identifier "dev.nimbus.headless.cli" \
  --version "$VERSION" \
  --install-location "/" \
  "$PKG_OUT"

rm -rf "$STAGE"
echo "Wrote $PKG_OUT"
