#!/usr/bin/env bash
# Full repo preflight — run before opening or updating any PR.
# Checks the lockfile and security audit, then delegates to scripts/run-tests.ts
# which mirrors the complete CI test suite (typecheck, lint, build, unit tests,
# coverage gates, integration tests, e2e, UI tests, VS Code extension tests).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"

step() { echo ""; echo "==> $*"; }

cd "$root"

step "Lockfile integrity"
bun install --frozen-lockfile

step "Security audit"
bun audit --audit-level high

step "Full CI test suite"
bun scripts/run-tests.ts

echo ""
echo "All preflight checks passed."
