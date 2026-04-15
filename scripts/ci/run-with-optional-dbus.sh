#!/usr/bin/env bash
# Run a command on the current OS. On Linux, delegate to linux-dbus-tests.sh (D-Bus + keyring for vault tests).
# On macOS/Windows CI, run the command directly.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
if [[ "$(uname -s)" != "Linux" ]]; then
  exec "$@"
fi
exec bash "$repo_root/scripts/linux/linux-dbus-tests.sh" "$@"
