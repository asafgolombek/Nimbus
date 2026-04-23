# Nimbus

**Local-first AI agent framework.** A headless Bun Gateway process that maintains a private SQLite index of your data across cloud services and executes multi-step agentic workflows on your behalf.

- **Runtime:** Bun v1.2+ / TypeScript 6.x strict
- **License:** AGPL-3.0 (gateway/cli/mcp-connectors) + MIT (sdk)
- **Status:** Phase 4 — Presence 🔵 Active

---

## Install

Nimbus v0.1.0 ships as **GPG-signed release artifacts** — no Apple Developer ID or Windows Authenticode cert, but a cryptographic integrity chain that works on every platform independently of OS code-signing. See [`docs/verify-release-integrity.md`](docs/verify-release-integrity.md) for the full story.

**Project GPG fingerprint:** see [`docs/SECURITY.md`](docs/SECURITY.md) — cross-check against four independent sources before trusting any key material.

### Linux

```bash
# .deb for Debian / Ubuntu (recommended)
curl -LO https://github.com/nimbus-dev/Nimbus/releases/download/v<ver>/nimbus-headless_<ver>_amd64.deb
curl -LO https://github.com/nimbus-dev/Nimbus/releases/download/v<ver>/nimbus-headless_<ver>_amd64.deb.asc
gpg --verify nimbus-headless_<ver>_amd64.deb.asc && sudo dpkg -i nimbus-headless_<ver>_amd64.deb

# AppImage (any glibc distro)
curl -LO https://github.com/nimbus-dev/Nimbus/releases/download/v<ver>/nimbus-headless-<ver>-x86_64.AppImage
chmod +x nimbus-headless-<ver>-x86_64.AppImage
./nimbus-headless-<ver>-x86_64.AppImage          # needs libfuse2 (on Ubuntu 24.04+: install libfuse2t64)
# — or —
./nimbus-headless-<ver>-x86_64.AppImage --appimage-extract-and-run  # no libfuse dep
```

### macOS

```bash
curl -LO https://github.com/nimbus-dev/Nimbus/releases/download/v<ver>/nimbus-headless-macos-arm64.tar.gz   # Apple Silicon
# or nimbus-headless-macos-x64.tar.gz for Intel
tar -xzf nimbus-headless-macos-*.tar.gz
xattr -d com.apple.quarantine nimbus-gateway-macos-* nimbus-cli-macos-*
./nimbus-gateway-macos-<arch> &
./nimbus-cli-macos-<arch> --help
```

Full walkthrough incl. Finder workflow: [`docs/install-macos-unsigned.md`](docs/install-macos-unsigned.md).

### Windows (PowerShell 7+)

```powershell
Invoke-WebRequest -Uri https://github.com/nimbus-dev/Nimbus/releases/download/v<ver>/nimbus-headless-windows-x64.zip -OutFile nimbus-headless.zip
Expand-Archive -Path nimbus-headless.zip -DestinationPath .\nimbus
cd nimbus
.\nimbus-gateway-windows-x64.exe
# SmartScreen: "More info" → "Run anyway" on first launch
```

Full walkthrough incl. Defender guidance: [`docs/install-windows-unsigned.md`](docs/install-windows-unsigned.md).

### Verify any download

```bash
# Linux + macOS
curl -LO https://github.com/nimbus-dev/Nimbus/releases/download/v<ver>/nimbus-verify.sh
bash nimbus-verify.sh --version <ver>
```

```powershell
# Windows
Invoke-WebRequest -Uri https://github.com/nimbus-dev/Nimbus/releases/download/v<ver>/nimbus-verify.ps1 -OutFile nimbus-verify.ps1
.\nimbus-verify.ps1 -Version <ver>
```

Exits `0` on full verification, `1` on any hash/signature mismatch. See [`docs/verify-release-integrity.md`](docs/verify-release-integrity.md) for the manual verification path, offline mode, and key-rotation procedure.
