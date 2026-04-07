#!/usr/bin/env bash
set -euo pipefail
exec bun "$(dirname "$0")/run-tests.ts"
