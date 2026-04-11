# Nimbus headless installers (Q2 §7.9)

Ship the **CLI** (`nimbus`) and **Gateway** (`nimbus-gateway`) as siblings — the same layout produced by `bun run package:headless` and expected by `packages/cli/src/lib/resolve-gateway-launch.ts` (`NIMBUS_GATEWAY_EXECUTABLE` override optional).

| Platform | Mechanism | CI / release |
|----------|-----------|--------------|
| **Linux** | `.deb` + `.tar.gz` via `bun run package:installers:linux` | PR (Ubuntu) + tagged `release.yml` attaches artifacts under `dist/installers/` |
| **Windows** | NSIS script `installers/windows/nimbus-headless.nsi` | Run locally or in a Windows runner: install [NSIS](https://nsis.sourceforge.io/), copy `nimbus.exe` + `nimbus-gateway.exe` next to the `.nsi`, then `makensis nimbus-headless.nsi` |
| **macOS** | `installers/macos/build-pkg.sh` (unsigned `pkg` for smoke; signing is release-time) | Run on macOS after `package:headless`; codesign + notarization use Apple Developer ID secrets (see below) |

## Layout conventions

- **Windows:** `%ProgramFiles%\Nimbus\` (see NSIS `InstallDir`).
- **Linux .deb:** `/usr/lib/nimbus/bin/{nimbus,nimbus-gateway}` + `/usr/local/bin` wrapper scripts.
- **Tarball:** extract and prepend `bin/` to `PATH`, or symlink into `/usr/local/bin`.
- **macOS .pkg:** installs into `/usr/local/bin` (matches script default).

## Signing & secrets (not in repo)

Configure in GitHub **Actions secrets** (see `.github/workflows/release.yml` placeholders):

- **Apple:** `MACOS_CERTIFICATE`, `MACOS_CERTIFICATE_PWD`, `MACOS_SIGNING_IDENTITY`, `NOTARIZATION_*` for `codesign` + `notarytool`.
- **Windows:** `WINDOWS_CERTIFICATE` + password for `signtool`, or sign the NSIS output in a post-step.

Unsigned nightly or tag artifacts are acceptable until certificates are available.

## Commands

```bash
# After Linux/macOS compile outputs exist in dist/ (see release workflow):
bun run package:headless
bun run package:installers:linux -- --version 1.2.3
```

On macOS:

```bash
export NIMBUS_RELEASE_VERSION=1.2.3
bash installers/macos/build-pkg.sh dist/headless-bundle
```

## Out of scope

Bundling MCP connector server binaries inside these installers is a future follow-up (see [`docs/roadmap.md`](../docs/roadmap.md)).
