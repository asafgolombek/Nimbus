#!/usr/bin/env bash
# Run a command on the current OS. On Linux, delegate to linux-dbus-tests.sh (D-Bus + keyring for vault tests).
# On macOS/Windows CI, run the command directly.
set -euo pipefail
if [ "$(uname -s)" != "Linux" ]; then
  exec "$@"
fi
exec bash scripts/linux/linux-dbus-tests.sh "$@"
