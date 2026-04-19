#!/usr/bin/env bash
# scripts/sign-macos.sh
# Wraps codesign + notarytool + stapler. Idempotent; no-op when secrets absent.
set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "usage: $0 <path-to-binary-or-app>" >&2
  exit 1
fi

if [ -z "${MACOS_CERTIFICATE:-}" ] || [ -z "${MACOS_SIGNING_IDENTITY:-}" ]; then
  echo "signing skipped: MACOS_CERTIFICATE not set"
  exit 0
fi

KEYCHAIN="build.keychain"
security create-keychain -p "$MACOS_CERTIFICATE_PWD" "$KEYCHAIN"
security default-keychain -s "$KEYCHAIN"
security unlock-keychain -p "$MACOS_CERTIFICATE_PWD" "$KEYCHAIN"
echo "$MACOS_CERTIFICATE" | base64 --decode > cert.p12
security import cert.p12 -k "$KEYCHAIN" -P "$MACOS_CERTIFICATE_PWD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -s -k "$MACOS_CERTIFICATE_PWD" "$KEYCHAIN"
rm cert.p12

codesign --deep --force --options runtime --sign "$MACOS_SIGNING_IDENTITY" "$TARGET"

if [ -n "${NOTARIZATION_APPLE_ID:-}" ] && [ -n "${NOTARIZATION_PASSWORD:-}" ] && [ -n "${NOTARIZATION_TEAM_ID:-}" ]; then
  ZIP="$(mktemp -d)/notarize.zip"
  ditto -c -k --keepParent "$TARGET" "$ZIP"
  xcrun notarytool submit "$ZIP" \
    --apple-id "$NOTARIZATION_APPLE_ID" \
    --password "$NOTARIZATION_PASSWORD" \
    --team-id "$NOTARIZATION_TEAM_ID" \
    --wait
  xcrun stapler staple "$TARGET"
else
  echo "notarization skipped: NOTARIZATION_APPLE_ID/PASSWORD/TEAM_ID not all set"
fi

echo "signed: $TARGET"
