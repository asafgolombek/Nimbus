#!/usr/bin/env bash
# Local preflight for the VS Code extension — mirrors the vscode-extension-integration CI job.
# Run from anywhere inside the repo before pushing or updating a PR.
# The live VS Code integration runner is skipped; it requires a display and is covered by CI.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"

step() { echo ""; echo "==> $*"; }

cd "$root"

step "Lockfile integrity"
bun install --frozen-lockfile

step "Security audit"
bun audit --audit-level high

step "Build @nimbus-dev/client"
cd "$root/packages/client" && bun run build

step "Build VS Code extension"
cd "$root/packages/vscode-extension" && bun run build

step "Typecheck VS Code extension"
cd "$root/packages/vscode-extension" && bun run typecheck

step "Compile integration tests"
cd "$root/packages/vscode-extension" && bunx tsc --project tsconfig.integration.json --noEmit false

step "Unit tests"
cd "$root/packages/vscode-extension" && bunx vitest run

echo ""
echo "All preflight checks passed."
