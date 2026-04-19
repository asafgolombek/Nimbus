#!/usr/bin/env bash
# scripts/sign-linux-gpg.sh
set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "usage: $0 <path>" >&2
  exit 1
fi

if [ -z "${GPG_PRIVATE_KEY:-}" ] || [ -z "${GPG_PASSPHRASE:-}" ]; then
  echo "signing skipped: GPG_PRIVATE_KEY not set"
  exit 0
fi

echo "$GPG_PRIVATE_KEY" | gpg --batch --import
gpg --batch --yes --passphrase "$GPG_PASSPHRASE" --pinentry-mode loopback \
  --detach-sign --armor "$TARGET"

echo "signed: $TARGET.asc"
