#!/usr/bin/env bash
# D-Bus session + Secret Service for Linux vault tests (libsecret / secret-tool).
# dbus-run-session alone does not register org.freedesktop.secrets; gnome-keyring-daemon does.
set -euo pipefail
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "linux-dbus-tests.sh: expected Linux" >&2
  exit 1
fi
if ! command -v dbus-run-session >/dev/null 2>&1; then
  if [[ "${CI:-}" == "true" ]]; then
    echo "linux-dbus-tests.sh: dbus-run-session not found on Linux CI (vault/keyring tests require a D-Bus session)" >&2
    exit 1
  fi
  exec "$@"
fi
dbus-run-session -- bash -c '
  set -euo pipefail
  if command -v gnome-keyring-daemon >/dev/null 2>&1; then
    echo "" | gnome-keyring-daemon --unlock --components=secrets --daemonize
    sleep 1
  fi
  exec "$@"
' _ "$@"
