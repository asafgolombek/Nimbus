Nimbus Headless — Quickstart
============================

This archive contains the Nimbus headless Gateway and CLI binaries.

Contents:
  nimbus-gateway-<os>-<arch>   The long-running Gateway daemon.
  nimbus-cli-<os>-<arch>       The CLI client.
  README-QUICKSTART.txt        This file.
  LICENSE-AGPL.txt             AGPL-3.0 license (full text).

Getting started (macOS / Linux):
  1. Extract this archive.
  2. chmod +x ./nimbus-gateway-* ./nimbus-cli-*
  3. Start the Gateway:   ./nimbus-gateway-<os>-<arch>
  4. In another terminal: ./nimbus-cli-<os>-<arch> --help

Getting started (Windows):
  1. Extract this archive (right-click → Extract All).
  2. Double-click nimbus-gateway-windows-x64.exe to start the Gateway.
  3. From a new PowerShell window: .\nimbus-cli-windows-x64.exe --help

Integrity verification:
  Before running, verify the archive's hash against the published
  SHA256SUMS manifest on the GitHub Release page. The manifest is
  GPG-signed — see docs/verify-release-integrity.md for a full walkthrough,
  or run the nimbus-verify.sh / nimbus-verify.ps1 helper from the same
  release page.

Project GPG fingerprint:
  See docs/SECURITY.md — cross-reference four independent sources
  before trusting any key material.

License:
  AGPL-3.0. Full text in LICENSE-AGPL.txt.

More information:
  https://github.com/asafgolombek/Nimbus
