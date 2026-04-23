#!/usr/bin/env bash
# Generates a scratch GPG keyring + test key at $1 (target dir).
# Used by nimbus-verify.test.ts; also callable manually for debugging.
set -euo pipefail

TARGET="${1:?usage: $0 <target-dir>}"
mkdir -p "$TARGET"
chmod 700 "$TARGET"

export GNUPGHOME="$TARGET"

cat > "$TARGET/gen-key.batch" <<EOF
%no-protection
Key-Type: EDDSA
Key-Curve: ed25519
Key-Usage: sign
Name-Real: Nimbus Test Signing
Name-Email: test@nimbus.local
Expire-Date: 1y
%commit
EOF

gpg --batch --generate-key "$TARGET/gen-key.batch" 2>/dev/null
rm -f "$TARGET/gen-key.batch"

# Print the fingerprint — caller captures it.
gpg --list-keys --with-colons | awk -F: '/^fpr:/ { print $10; exit }'
