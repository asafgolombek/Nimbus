# Headless Signing Pipeline — Design Spec (v0.1.0, Phase 1)

**Date:** 2026-04-23
**Authoritative source:** `docs/release/v0.1.0-finish-plan.md §4.2` (Signing Pipeline + Unsigned-Install Documentation). This spec implements that scope with four scope refinements resolved during brainstorming.
**Phase placement:** Phase 1 of a two-phase approach. Phase 2 (Tauri UI build track on `release.yml`) is a follow-up spec, not this one.
**Prior art:** `docs/superpowers/plans/2026-04-22-ws5d-polish.md` (shipped, PR #83); release-environment follow-up tracked in that plan's §"Release-gate follow-ups" is absorbed into this spec as a deliverable.

---

## 1. Purpose & Motivation

Nimbus v0.1.0 needs a shippable release pipeline. Today, `release.yml` builds headless Gateway + CLI binaries across Linux / macOS (x64 + arm64) / Windows, produces a Linux `.deb` + tarball, attaches an SBOM + build-provenance attestation, and publishes an Ed25519-signed updater manifest. What's missing:

- No end-user-verifiable integrity proof that works across platforms.
- macOS + Windows signing steps exist but gracefully no-op without certs — dead code per `finish-plan §4.2`'s non-deliverables list.
- No `AppImage` (Linux `.deb` + tarball only).
- No end-user install docs for the unsigned-macOS / unsigned-Windows case.
- No `release` GitHub Environment gating on publish jobs — a stolen GHA token could push a release without human approval.

This spec adds a `SHA256SUMS` + detached-GPG-signed `SHA256SUMS.asc` manifest as the **cross-platform integrity story**, extends Linux installers with `AppImage`, ships a `nimbus-verify.{sh,ps1}` one-liner for end users, adds three install/verify docs, strips the no-op codesign/signtool code paths, and gates publish jobs on the `release` environment.

Signing the headless macOS + Windows binaries themselves is explicitly **not** in scope (see §3); the Tauri UI track (Phase 2) will carry the signed-desktop-app surface when cert procurement is funded.

---

## 2. Scope

### 2.1 In scope (Phase 1)

1. **`SHA256SUMS` + `SHA256SUMS.asc`** manifest over the headless release artifact set, computed in the `publish-release` job and signed via the existing `scripts/sign-linux-gpg.sh`.
2. **AppImage extension** in `scripts/package-linux-installers.ts` — adds `nimbus-headless-<ver>-x86_64.AppImage` alongside the existing `.deb` + tarball outputs, using `appimagetool` with a pinned version and SHA-verified download.
3. **Archive-wrapped distribution for macOS + Windows** — ship `nimbus-headless-macos-x64.tar.gz`, `nimbus-headless-macos-arm64.tar.gz`, `nimbus-headless-windows-x64.zip`. Each archive contains the raw compiled `bun build --compile` output (the Gateway + CLI binaries) plus a one-page `README-QUICKSTART.txt`. `.tar.gz` on macOS preserves the executable bit; `.zip` on Windows is the conventional download format. Integrity via `SHA256SUMS.asc`. Native `.pkg` / `-setup.exe` installers are **not** produced — those duplicate what the Phase 2 UI track will deliver for users who want a GUI-installable binary. Raw binaries from `build-gateway` / `build-cli` CI artifacts also ship (alongside the archives) so auto-update's machine-consumed download path stays byte-identical to what the build produced.
4. **`scripts/release/nimbus-verify.sh`** (Linux + macOS) and **`scripts/release/nimbus-verify.ps1`** (Windows) — one-command helpers that download `SHA256SUMS` + `SHA256SUMS.asc`, import the project GPG key from a keyserver, and verify any artifact present in cwd. Exit 0 iff every present artifact verifies.
5. **Three new end-user docs:**
   - `docs/install-macos-unsigned.md` — Gatekeeper-bypass workflow + "Why unsigned?" framing.
   - `docs/install-windows-unsigned.md` — SmartScreen-bypass workflow + Defender exclusion guidance + "Why unsigned?" framing.
   - `docs/verify-release-integrity.md` — the authoritative integrity-chain explanation + manual-verification walkthrough.
6. **`docs/release/SIGNING-KEY.asc`** placeholder committed (real bytes land when the maintainer completes prerequisites §3; `nimbus-verify` does not rely on the committed file).
7. **README "Install" section** with three OS subsections, each leading with a "Power-User Shortcut" one-liner and linking to the relevant doc.
8. **`.github/workflows/release.yml` edits:**
   - Remove the `Sign binary (macOS)` step.
   - Remove the `Sign binary (Windows)` step.
   - Rename the `Linux .deb + tarball` step to `Linux installers`; extend it to produce `.AppImage`.
   - Add `Sign Linux installer artifacts` step covering `.deb` + `.AppImage` + tarball.
   - Add `Compute SHA256SUMS` + `Sign SHA256SUMS` steps in `publish-release`.
   - Add `SHA256SUMS` + `SHA256SUMS.asc` to the `softprops/action-gh-release` upload list.
   - Add `environment: release` to `publish-release` and `update-manifest` jobs.
9. **Delete `scripts/sign-macos.sh` + `scripts/sign-windows.ps1`** entirely. No other callers in the repo.
10. **Prerequisites runbook deltas** (`docs/release/v0.1.0-prerequisites.md`):
    - Move §1 (Windows EV cert) and §2 (Apple Developer ID) to a new `Deferred to a Later Point Release` section.
    - Drop 7 secret rows from §9.5.
    - Update the cost summary to reflect $12 total first-year (domain only).
    - Update the handoff checklist to reflect the new 6-secret total.
11. **Finish-plan delta** (`docs/release/v0.1.0-finish-plan.md §4.2`): update the acceptance-criteria artifact list to reflect the Phase-1 scope (drops `.pkg` + `-setup.exe` for headless; noted as Phase 2 deliverables via UI track).

### 2.2 Out of scope — deferred to Phase 2 (Tauri UI track spec)

- `build-ui` matrix on `release.yml` (one job per OS calling `bunx tauri build`).
- Tauri bundler signing configuration (`tauri.conf.json` → `signingIdentity`, `certificateThumbprint`).
- UI installers: `.dmg` + `.pkg` (macOS), `.msi` (Windows), `.deb` + `.AppImage` (Linux) produced by the Tauri bundler.
- UI artifacts flowing into the Phase-1 `SHA256SUMS` manifest (manifest will be extended, not replaced, in Phase 2).
- UI install docs (`docs/install-ui-macos.md` etc., if they prove needed).

### 2.3 Out of scope — maintainer operational work, documented only

- Generating the production GPG master + signing subkey (prerequisites §3 owns).
- Overwriting `docs/release/SIGNING-KEY.asc` placeholder with real bytes (maintainer follow-up commit after §3).
- Uploading the public key to `keys.openpgp.org` and `keyserver.ubuntu.com` (two keyservers for redundancy; command documented in prerequisites §3 and `verify-release-integrity.md`).
- Creating the `release` GitHub Environment in repo Settings → Environments with required reviewer = maintainer and deployment branches = `main`. YAML-side `environment: release` has no effect until the environment is created; documented as a one-time setup step.
- Populating `GPG_SIGNING_SUBKEY`, `GPG_PASSPHRASE`, `UPDATER_ED25519_PRIVATE_KEY`, and `RELEASE_PAT` repo secrets.

### 2.4 Explicit non-goals

- No `codesign` / `notarytool` / `stapler` in `release.yml`. No Apple cert or notarization secrets referenced anywhere in the repo after this spec merges.
- No `signtool` / Authenticode logic. No Windows cert secrets referenced.
- No `.rpm` production for Fedora/RHEL (Phase 5+ workstream if demanded).
- No arm64 Linux AppImage (x86_64 only, matching existing `.deb` scope).
- No `docs/install-linux.md` — Linux install via `.deb` / `.AppImage` / tarball is per-format standard and covered by a README paragraph.
- No mandatory `--sign-hashes` flow enforced on users — `SHA256SUMS.asc` is a recommendation, not a gate, and unverified installs still work. `nimbus-verify` is a convenience wrapper.

---

## 3. Architecture

### 3.1 Integrity chain seen by an end user

```
user's trust root
  └─ project GPG public key fingerprint              ← published in FOUR places:
     ├─ keys.openpgp.org (keyserver, primary)         · keys.openpgp.org (keyserver)
     ├─ keyserver.ubuntu.com (keyserver, redundant)   · keyserver.ubuntu.com (keyserver)
     ├─ docs/SECURITY.md (repo, human-readable)       · repo README-linked (out-of-band)
     └─ docs/release/SIGNING-KEY.asc (repo, key body) · repo (audit)
          └─ SHA256SUMS.asc  (detached armored GPG signature)
               └─ SHA256SUMS  (text manifest: `<sha256>  <filename>` per line)
                    └─ each release artifact  (SHA-256 hash-verified)
```

The fingerprint appears in **four out-of-band places** so a first-time user has multiple independent sources to cross-check before trusting anything they downloaded. If the four sources diverge, `verify-release-integrity.md` instructs the user to **stop and open a security issue**. This is the answer to the verify-script bootstrap problem (how do you trust `nimbus-verify.sh` the first time you run it?) — the script prints the fingerprint it imported, and the user cross-checks against `SECURITY.md` / README / keyservers before letting the script touch their keyring.

One `gpg --verify` plus one `sha256sum -c` verifies any headless artifact on any OS. The `nimbus-verify.{sh,ps1}` scripts automate this sequence; the chain itself is unchanged whether a user uses the script or runs the commands manually.

### 3.2 Release artifact set (Phase 1 final)

| Artifact | OS | Signed? | In `SHA256SUMS`? |
|---|---|---|---|
| `nimbus-gateway-linux-x64` | Linux | `.asc` sidecar | Yes |
| `nimbus-cli-linux-x64` | Linux | `.asc` sidecar | Yes |
| `nimbus-gateway-macos-x64` | macOS Intel | — | Yes |
| `nimbus-cli-macos-x64` | macOS Intel | — | Yes |
| `nimbus-gateway-macos-arm64` | macOS ARM | — | Yes |
| `nimbus-cli-macos-arm64` | macOS ARM | — | Yes |
| `nimbus-gateway-windows-x64.exe` | Windows | — | Yes |
| `nimbus-cli-windows-x64.exe` | Windows | — | Yes |
| `nimbus-headless-macos-x64.tar.gz` *(new)* | macOS Intel | — | Yes |
| `nimbus-headless-macos-arm64.tar.gz` *(new)* | macOS ARM | — | Yes |
| `nimbus-headless-windows-x64.zip` *(new)* | Windows | — | Yes |
| `nimbus-headless_<ver>_amd64.deb` | Linux | `.asc` sidecar | Yes |
| `nimbus-headless-linux-amd64.tar.gz` | Linux | `.asc` sidecar | Yes |
| `nimbus-headless-<ver>-x86_64.AppImage` *(new)* | Linux | `.asc` sidecar | Yes |
| `nimbus-<ver>-sbom.cdx.json` | any | — (SBOM OIDC attested) | Yes |
| `SHA256SUMS` *(new)* | all | — (it's the manifest) | — (self-excluded) |
| `SHA256SUMS.asc` *(new)* | all | — (it's the signature) | — (self-excluded) |
| `latest.json` | any | Ed25519 (inline `signature` field, existing) | **No** — machine-consumed by updater; has its own signature |
| `nimbus-verify.sh` | all | — | Yes |
| `nimbus-verify.ps1` | all | — | Yes |

**Rationale for excluding `latest.json`:** The updater verifies `latest.json` with its embedded Ed25519 public key independently of GPG. End users don't hand-verify `latest.json`. Keeping the `SHA256SUMS` manifest pinned to user-facing artifacts matches user mental models; `verify-release-integrity.md` documents this explicitly.

**Rationale for archive-wrapping macOS + Windows (revised from original spec):** Raw `.exe` and extensionless-macOS binaries trigger browser "Uncommon Download" heuristics (Chrome, Edge) and can have the executable bit stripped by the browser on macOS. Wrapping in `.tar.gz` (macOS, preserves permissions) and `.zip` (Windows, conventional) avoids both problems, allows bundling a `README-QUICKSTART.txt` + `LICENSE-AGPL.txt` inside each archive, and matches download conventions users expect on each OS. The cost — one extra `tar -xzf` / "Extract All" step — is a smaller UX tax than a blocked download. Raw binaries still ship alongside the archives so the auto-updater's machine-consumed download path remains byte-stable against build output.

**Rationale for no per-file `.asc` on macOS/Windows artifacts:** `SHA256SUMS.asc` already covers them transitively via the manifest. Adding per-file `.asc` doubles the artifact count with no additional security. Linux binaries keep `.asc` sidecars because the existing workflow step already produces them and Linux packagers consume `.deb.asc` directly.

### 3.3 `SHA256SUMS` format

Standard GNU coreutils / `sha256sum` format: one line per artifact, two-space separator, filename-only (no path).

```
<64-hex-hash>  <filename>
```

Example (artifact names are illustrative; real hashes differ):

```
3f5b2c1e...  nimbus-gateway-linux-x64
a2e1f983...  nimbus-cli-linux-x64
...
```

**Ordering.** `LC_ALL=C sort -k2` on the manifest before committing it to the signing step. Locale-invariant sort (`LC_ALL=C`) ensures the order is deterministic across runner images / OS defaults; `-k2` sorts by filename. This makes `SHA256SUMS` byte-identical across re-runs given the same inputs; stable ordering also makes diffs readable if the same version is re-tagged.

**Filenames are stems, not paths.** Users verify from their download folder with `sha256sum -c SHA256SUMS` and expect filenames to match what the browser / `curl` wrote. Storing a path would break that.

### 3.4 `release.yml` job graph (post-spec)

```
validate ── test ──┬─ build-gateway (matrix: linux / macos-x64 / macos-arm64 / windows)
                   ├─ build-cli     (matrix: linux / macos-x64 / macos-arm64 / windows)
                   │
                   └────────────────► publish-release  [environment: release]
                                        │  - Download all artifacts
                                        │  - Build Linux installers (.deb + tarball + .AppImage)
                                        │  - Sign Linux installer artifacts (new)
                                        │  - Generate SBOM
                                        │  - Compute SHA256SUMS (new)
                                        │  - Sign SHA256SUMS → SHA256SUMS.asc (new)
                                        │  - Create GitHub Release (upload incl. SHA256SUMS + .asc)
                                        │
                                        └─► update-manifest  [environment: release]
                                              - Build latest.json (Ed25519-signed)
                                              - Upload to release
```

Build-side signing per-binary on Linux stays in `build-gateway` / `build-cli` (step `Sign binary (Linux GPG)`). The new `Sign Linux installer artifacts` step in `publish-release` covers artifacts produced **in** `publish-release` (the `.deb`, tarball, `.AppImage`) — they don't exist in `build-gateway` / `build-cli`.

### 3.5 `nimbus-verify` script interface

Common command-line contract (both `.sh` and `.ps1`):

```
Usage: nimbus-verify [<artifact-path>]
       nimbus-verify --version <ver>

Flags:
  --version <ver>       fetch SHA256SUMS + .asc for <ver> from the GitHub Release; verify
                        all artifacts present in cwd matching names in the manifest
  --keyserver <url>     keyserver to fetch public key from (default: keys.openpgp.org)
  --fingerprint <fp>    override the trusted fingerprint set (comma-separated for multi-fp
                        rotation periods); default: baked-in TRUSTED_FINGERPRINTS array
  --no-fetch            offline mode: don't download SHA256SUMS / key; use what's in cwd /
                        keyring. Use this as the "check-only" mode for pre-staged
                        verifications or CI pipelines.
  --help, -h

Exit codes:
  0   every present artifact verified (signature + hash)
  1   at least one verification failed
  2   usage error / missing prerequisites (gpg, sha256sum, curl)
```

Step sequence identical in both (differences are syntactic, not semantic):

1. Resolve `SHA256SUMS` + `SHA256SUMS.asc` location (same dir as artifact, or cwd for `--version`). Download from GitHub Release if absent and `--no-fetch` not set.
2. Ensure the project GPG key is in the user's keyring. Baked-in fingerprint constant at the top of each script. `gpg --keyserver <ks> --recv-keys <fp>` if missing. Print which fingerprint was imported.
3. `gpg --verify SHA256SUMS.asc SHA256SUMS`. Parse exit code + stderr markers for `EXPKEYSIG`, `REVKEYSIG`, `NOTATION_DATA` mismatches. Do not rely on stdout alone.
4. Hash-verify the artifact(s) present in cwd: `sha256sum -c --ignore-missing SHA256SUMS` (Linux/macOS) or a PowerShell `Get-FileHash SHA256 | Compare-Object` (Windows). "Missing" files are OK (user downloaded only one artifact); "hash mismatch" is a hard failure.
5. Print per-artifact:
   - `✅ Verified <filename>: signature OK, hash OK`
   - `❌ <filename>: signature FAILED` / `<filename>: hash MISMATCH <expected> ≠ <actual>`
6. Exit.

**Design constraints:**
- Depend only on system `gpg` + `sha256sum` / `Get-FileHash` + `curl` / `Invoke-WebRequest`. No Bun, no Nimbus binary required.
- Both scripts are readable in one screenful (< 150 lines each).
- Offline mode via `--no-fetch` for air-gapped verification and CI pipelines (this covers the "check-only" use case — no separate flag).
- Same user contract across platforms so docs can share examples.
- **Bootstrap trust:** the script **prints the fingerprint it imported** before `gpg --verify`. The three install docs and `verify-release-integrity.md` tell first-time users to cross-check the printed fingerprint against `docs/SECURITY.md` (committed to the repo), `README.md`, and either keyserver. If any of the four diverge, **do not proceed — open a security issue**. This gives the user an out-of-band verification path for the scripts themselves.

**Key rotation — array of trusted fingerprints.** Each script carries a `TRUSTED_FINGERPRINTS` array (bash array in `.sh`, PowerShell array in `.ps1`) holding the fingerprint(s) currently considered valid. A verification passes if the signing fingerprint on `SHA256SUMS.asc` matches **any** entry in the array. Rotation procedure:

1. Generate the new key offline (prerequisites §3 process).
2. Release `vN.N.N+1` signed by the **old** key, containing `nimbus-verify.{sh,ps1}` with `TRUSTED_FINGERPRINTS = [<old>, <new>]` (both accepted). Users who upgrade via `vN.N.N+1` pick up the new fingerprint.
3. Release `vN.N.N+2` signed by the **new** key, containing `TRUSTED_FINGERPRINTS = [<new>]` only. Old fingerprint retired.
4. Publish `docs/SECURITY.md` update + keyserver revocation of old key at step 3.

`--fingerprint` on the command line accepts comma-separated fingerprints, giving users a manual override for unusual situations (e.g., verifying a pre-release using a yet-to-be-published key). Rotation pattern documented with worked example in `docs/verify-release-integrity.md` "Key rotation" section.

### 3.6 `package-linux-installers.ts` extension

**Current outputs:** `.deb` via `/usr/bin/dpkg-deb`, tarball via `/usr/bin/tar`. Uses absolute paths (Sonar S4036 hardening). Reads `dist/headless-bundle/` layout from `package-headless-bundle.ts`.

**New function:**

```ts
async function buildAppImage(
  bundleDir: string,
  outDir: string,
  version: string,
): Promise<string>   // returns path to emitted .AppImage
```

Inputs: the same `dist/headless-bundle/` directory, an output directory, and version string.

Outputs: `<outDir>/nimbus-headless-<version>-x86_64.AppImage`.

Process:

1. `ensureAppImageTool()` — download the pinned `appimagetool-*-x86_64.AppImage` binary, verify its SHA-256 against a compile-time constant, cache at `~/.nimbus-ci-cache/appimagetool-<ver>`. Idempotent on re-run.
2. Materialize an AppDir in a tmp directory:

   ```
   nimbus-headless.AppDir/
   ├── AppRun                                          (shell shim)
   ├── nimbus-headless.desktop                         (Desktop Entry)
   ├── nimbus-headless.png                             (256×256 icon)
   └── usr/
       ├── bin/
       │   ├── nimbus                                  (from bundle)
       │   └── nimbus-gateway                          (from bundle)
       └── share/applications/nimbus-headless.desktop  (duplicate per AppImage spec)
   ```

3. Run `appimagetool <AppDir> <outPath>`. Exit non-zero on failure; no silent fallback.
4. Return the emitted path.

**New committed assets under `scripts/linux/`:**

- `nimbus-headless.AppRun` — 3-line shell shim: `HERE="$(dirname "$(readlink -f "$0")")"; exec "$HERE/usr/bin/nimbus" "$@"`.
- `nimbus-headless.desktop` — Desktop Entry template with `{{VERSION}}` placeholder substituted at build time. `Type=Application`, `Terminal=true`, `Exec=nimbus %U`, `Categories=Development;Utility;`, `Icon=nimbus-headless`.
- `nimbus-headless.png` — 256×256 icon (committed binary ~5–10 KB; placeholder allowed at spec merge time, real icon from UI design pass when available). Use a distinctive CLI-themed placeholder (terminal-prompt glyph style), not a generic gear / cloud / blank shape, so the Dock / taskbar preview isn't mistaken for a broken app.

**CI surface:** The `publish-release` job runs on `ubuntu-22.04` (pinned explicitly in `release.yml`, not `ubuntu-latest`), which has `libfuse2` available as an apt package. One new `apt-get install -y libfuse2` line in the Linux-installers step; idempotent on re-runs. Ubuntu 22.04 LTS support window extends through 2027, giving us runway; if GitHub retires `ubuntu-22.04` before then, the fallback is `appimagetool --appimage-extract-and-run` (invokes the tool without needing FUSE mounted).

**User-side FUSE portability.** Users running the emitted `.AppImage` on Ubuntu 24.04+, Fedora 40+, Arch, or other distros that ship `libfuse3` without `libfuse2` by default must either `apt install libfuse2t64` (the libfuse3-era transitional package) **or** run the AppImage with `./nimbus-headless.AppImage --appimage-extract-and-run`. Both paths are documented in `docs/verify-release-integrity.md` (which references them from the AppImage launch instructions) and in the README Linux install subsection.

### 3.7 `release.yml` structural changes

#### 3.7.1 Remove

- `Sign binary (macOS)` step in `build-gateway` matrix (lines 109–119 of current `release.yml`). Removes the `MACOS_CERTIFICATE`, `MACOS_CERTIFICATE_PWD`, `MACOS_SIGNING_IDENTITY`, `NOTARIZATION_APPLE_ID`, `NOTARIZATION_PASSWORD`, `NOTARIZATION_TEAM_ID` env references.
- `Sign binary (Windows)` step in `build-gateway` matrix (lines 121–128). Removes the `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PWD` env references.
- Both steps exist identically-named in `build-cli` in the current file — same treatment; they go away there too. (Verify during implementation.)

#### 3.7.2 Modify

- `Linux .deb + tarball` step in `publish-release` → renamed `Linux installers`. Body extended to call `package-linux-installers.ts` which now also emits `.AppImage` (see §3.6). Additionally, prepend `sudo apt-get install -y libfuse2` so `appimagetool` can run.

#### 3.7.3 Add (all in `publish-release`, in order)

1. **After `Linux installers`:** new step `Sign Linux installer artifacts`. Runs `sign-linux-gpg.sh` against each of `.deb`, `.AppImage`, `.tar.gz` in `dist/installers/`. Same secrets (`GPG_PRIVATE_KEY`, `GPG_PASSPHRASE`) as the per-binary step in `build-gateway` / `build-cli`.
2. **After `Sign Linux installer artifacts`:** new step `Build macOS + Windows archives`. Shell: for each of macos-x64 / macos-arm64 — `tar -czf dist/archives/nimbus-headless-macos-<arch>.tar.gz -C dist/nimbus-gateway-macos-<arch> nimbus-gateway-macos-<arch> -C ../nimbus-cli-macos-<arch> nimbus-cli-macos-<arch>` plus the `README-QUICKSTART.txt` + `LICENSE-AGPL.txt` from `scripts/release/archive-contents/`. For Windows — `zip` the two `.exe` files and the same two text files into `dist/archives/nimbus-headless-windows-x64.zip`. Archives preserve the `+x` bit on `.tar.gz` (not relevant for `.zip`).
3. **Before `Create GitHub Release`:** new step `Stage release assets`. Creates flat-layout `dist/stage/` and populates it with: every file under `dist/nimbus-gateway-*/`, `dist/nimbus-cli-*/`, `dist/installers/`, `dist/archives/`, `dist/sbom/`, plus `scripts/release/nimbus-verify.sh` + `nimbus-verify.ps1`. Excludes `latest.json` (published by the downstream `update-manifest` job; see §3.2 rationale).
4. **Immediately before `Create GitHub Release`:** new step `Compute SHA256SUMS`. Bash — `dist/stage/` is a flat-layout staging directory populated by the "Stage release assets" step (all assets destined for the Release except `latest.json`):

   ```bash
   cd dist/stage
   LC_ALL=C sha256sum * | LC_ALL=C sort -k2 > SHA256SUMS
   ```

   `LC_ALL=C` on both `sha256sum` and `sort` guarantees byte-identical output across runner images and locales.

5. **Immediately after `Compute SHA256SUMS`:** new step `Sign SHA256SUMS`. Calls `bash scripts/sign-linux-gpg.sh dist/stage/SHA256SUMS`, producing `dist/stage/SHA256SUMS.asc`. Same `GPG_PRIVATE_KEY` + `GPG_PASSPHRASE` secrets.
6. **Modify `Create GitHub Release` `files:` glob** to a single `dist/stage/*` entry. The flat-layout staging dir means one glob covers every asset (including `SHA256SUMS`, `SHA256SUMS.asc`, `.AppImage` + `.asc`, verify scripts, SBOM, archives, and all `.asc` sidecars); the earlier per-path globs disappear.

#### 3.7.4 Gate

- Add `environment: release` to `publish-release` job. With the `release` environment created in repo settings with required reviewer = maintainer, the job will **pause** on the Actions UI until approved, every release tag.
- Add `environment: release` to `update-manifest` job. Same reasoning — `latest.json` publication is a release-critical write.

Neither `build-gateway` nor `build-cli` gains `environment: release`. Artifact-producing jobs need to run to make approval meaningful.

---

## 4. File Map

### 4.1 Create

- `scripts/release/nimbus-verify.sh` — shell helper for Linux + macOS. ~130 lines.
- `scripts/release/nimbus-verify.ps1` — PowerShell helper for Windows. ~130 lines.
- `scripts/release/nimbus-verify.test.ts` — driven via `bun test` shelling out to `bash`. Fixtures: valid chain, tampered manifest, untrusted key, `--no-fetch` missing inputs.
- `scripts/package-linux-installers.test.ts` — covers the new AppImage path with a stubbed `appimagetool` (no existing test file for this script).
- `scripts/linux/nimbus-headless.AppRun` — 3-line shell shim template.
- `scripts/linux/nimbus-headless.desktop` — Desktop Entry template with `{{VERSION}}` placeholder.
- `scripts/linux/nimbus-headless.png` — 256×256 icon (placeholder permitted at spec merge; real asset follows).
- `docs/install-macos-unsigned.md` — Gatekeeper-bypass workflow + "Why unsigned?" framing.
- `docs/install-windows-unsigned.md` — SmartScreen-bypass workflow + Defender exclusion guidance + "Why unsigned?" framing.
- `docs/verify-release-integrity.md` — integrity-chain explanation + manual-verification walkthrough.
- `docs/release/SIGNING-KEY.asc` — placeholder ASCII-armored block with a header comment pointing at prerequisites §3.
- `scripts/release/archive-contents/README-QUICKSTART.txt` — one-page quickstart bundled into every macOS + Windows archive. Content: what's in the archive, how to chmod/run, link to `verify-release-integrity.md`, GPG fingerprint for out-of-band cross-check.
- `scripts/release/archive-contents/LICENSE-AGPL.txt` — symlink or copy of the repo-root AGPL-3.0 license, included in every archive to satisfy AGPL redistribution requirements.

### 4.2 Modify

- `.github/workflows/release.yml` — remove codesign + signtool steps from `build-gateway` + `build-cli`; rename `Linux .deb + tarball` step; add `Sign Linux installer artifacts`, `Stage nimbus-verify scripts`, `Compute SHA256SUMS`, `Sign SHA256SUMS` steps in `publish-release`; extend `Create GitHub Release` `files:` glob; add `environment: release` to `publish-release` + `update-manifest`.
- `scripts/package-linux-installers.ts` — add `buildAppImage()` + `ensureAppImageTool()` helpers; wire into `main()`; add `apt-get install libfuse2` invocation documented in a comment near the tool pin (actual install happens in release.yml — the script just depends on `libfuse2` being present).
- `README.md` — add `## Install` section with Linux / macOS / Windows subsections + "Verify any download" subsection.
- `docs/release/v0.1.0-prerequisites.md` — move §1 + §2 to a new `Deferred to a Later Point Release` section near the bottom; update §9.5 secrets table (drop 7 rows, keep 6); update Summary table + cost paragraph; update Handoff Checklist secret count.
- `docs/release/v0.1.0-finish-plan.md` — update §4.2 acceptance-criteria artifact list to reflect Phase-1 scope (drops `.pkg` + `-setup.exe`; notes these land in Phase 2 via Tauri UI track; adds `.tar.gz` + `.zip` archives).
- `docs/SECURITY.md` — add a new `## Release Signing Key` section listing the GPG fingerprint, the four publication locations (two keyservers + `SIGNING-KEY.asc` in repo + README), and a one-paragraph link to `docs/verify-release-integrity.md`. This is the human-readable out-of-band fingerprint source referenced from the verify scripts.

### 4.3 Delete

- `scripts/sign-macos.sh` — no remaining callers after release.yml edits.
- `scripts/sign-windows.ps1` — same.

---

## 5. Data Flow — Full Release Path

```
git tag v0.1.0-rc1
       │
       ▼ triggers workflow
validate (typecheck)
       │
       ▼
test (full bun test on ubuntu)
       │
       ▼   parallel fan-out
       ├─ build-gateway (matrix 4 OS) ──┐
       └─ build-cli     (matrix 4 OS) ──┤   raw binaries + Linux .asc
                                        │   + Ed25519 updater sig
                                        ▼
                                 publish-release  [paused on `release` env]
                                        │
                                   [maintainer clicks approve in Actions UI]
                                        │
                                        ▼
                                 • download-artifact → dist/
                                 • Linux installers: .deb + tarball + .AppImage
                                 • Sign Linux installer artifacts (.asc sidecars)
                                 • Build macOS + Windows archives (.tar.gz / .zip)
                                 • Generate SBOM (anchore)
                                 • Stage release assets in dist/stage/
                                 • Compute SHA256SUMS (LC_ALL=C sort -k2)
                                 • Sign SHA256SUMS → SHA256SUMS.asc
                                 • softprops/action-gh-release
                                       → uploads everything to the GitHub Release
                                        │
                                        ▼
                                 update-manifest  [paused on `release` env]
                                        │
                                   [maintainer clicks approve again]
                                        │
                                        ▼
                                 • build-update-manifest.ts
                                 • upload latest.json to the release
                                        │
                                        ▼
                                 Release is live.
                                 End users download + run nimbus-verify.
```

**Key invariant.** From the moment `publish-release` begins uploading artifacts to the GitHub Release, every new asset is covered by `SHA256SUMS` + `SHA256SUMS.asc` **before** the release is visible to end users, because `action-gh-release` with `draft: false` only makes assets visible after the step completes — and `SHA256SUMS` is in the same upload batch as the artifacts it covers.

---

## 6. Error Handling

### 6.1 CI-side failure modes

| Failure | Behavior | Recovery |
|---|---|---|
| Any `build-gateway` / `build-cli` matrix job fails | Job exits non-zero; `publish-release` never runs | Fix code, re-tag |
| `Sign Linux installer artifacts` fails (bad GPG key, wrong passphrase) | Job exits non-zero; no Release created | Rotate / re-import key per prerequisites §3; re-tag |
| `Compute SHA256SUMS` fails (missing artifact) | Job exits non-zero; no Release created | Investigate artifact download; re-tag |
| `Sign SHA256SUMS` fails | Same as above — no Release created | Same as above |
| `action-gh-release` partial upload (rare network failure) | Release exists with incomplete assets | GitHub UI: delete release + tag; re-tag |
| `libfuse2` install fails on runner | `appimagetool` can't run; Linux-installers step fails | Investigate runner image change; pin runner to known-good SHA |
| `appimagetool` SHA-verify fails | Script aborts before running the tool | Update pin constant; audit upstream for legit version rotation |
| `release` environment reviewer clicks "Reject" | `publish-release` exits "cancelled"; no assets uploaded | Maintainer investigates; re-tag or run-off with corrected state |

Every path above is **fail-closed**: a broken signing step stops the release before the Release page exists. Users never see partially-signed releases.

### 6.2 User-side failure modes (`nimbus-verify`)

| Failure | Script behavior | User guidance (in `docs/verify-release-integrity.md`) |
|---|---|---|
| GPG not installed | Exit 2 with clear error + install hint | Install GPG via homebrew / apt / Gpg4win |
| Network failure fetching key | Exit 2; instruct `--no-fetch` + manual import | Link to `docs/release/SIGNING-KEY.asc` in the repo as fallback |
| Fingerprint mismatch (received key != expected fingerprint) | Exit 1 with `❌ SIGNATURE FAILED — fingerprint mismatch` | **Do not install** — open a security issue |
| Signature verifies but hash fails | Exit 1 with `❌ <file>: hash MISMATCH` | Re-download the file; if persistent, the release is corrupted |
| Signature fails with `EXPKEYSIG` / `REVKEYSIG` | Exit 1 with a specific error citing key expiry / revocation | Key rotation doc explains; install via the current release's fingerprint |
| User downloaded only one artifact; others missing locally | Counted as "not present," skipped, not errored (`sha256sum -c --ignore-missing`) | Expected behavior — script verifies what's present |

**Silent failure avoidance.** Every error path prints a user-facing line prefixed with `❌` and a brief reason. Exit code distinguishes usage errors (2) from integrity failures (1) so CI wrappers can treat them differently.

### 6.3 Release-environment gate edge cases

| Scenario | Outcome |
|---|---|
| `release` environment not yet created in repo settings | `environment: release` YAML causes GitHub to create a default environment with no reviewers → job runs unattended. **Risk.** Mitigated by the prerequisites handoff checklist which includes "`release` environment configured with maintainer-reviewer." Spec commits a verification step in the implementation plan: `gh api repos/<owner>/<repo>/environments/release` must return a non-empty `protection_rules` array before tagging. |
| Maintainer is unavailable to approve | Job sits paused; Actions retention expires after 30 days default, but the tag is persistent → re-trigger possible | Document in runbook |
| Tag re-used after rejection | The tag still exists; approving a second run on the same tag is possible if the workflow_run is re-dispatched from Actions UI | Expected operational flexibility |

---

## 7. Testing Strategy

### 7.1 Unit tests

- **`scripts/package-linux-installers.test.ts`** (new file — script has no existing test coverage).
  - New `buildAppImage()` test: given a fixture bundle directory, call the function with a stubbed `appimagetool` (script emits a fixed byte sequence). Assert filename matches `nimbus-headless-<ver>-x86_64.AppImage` and first 4 bytes are valid.
  - Smoke tests for existing `.deb` and tarball paths (uncovered today) — sized to fit inside the AppImage test file to keep the new test surface cohesive; no separate tech-debt ticket.
  - AppDir layout assertion: the AppDir materialized pre-tool-invocation contains `AppRun`, `*.desktop`, icon, `usr/bin/nimbus*` — covered by a test that stubs `appimagetool` with a no-op and inspects the pre-invocation directory state.
  - Negative: missing `AppRun` template → clear error before tool invocation.

- **`scripts/release/nimbus-verify.test.ts`** (new).
  - Drive `bash nimbus-verify.sh` via `bun test` + `spawn`. Fixtures live in `tests/fixtures/signing/`.
  - Case A: valid `SHA256SUMS` + `SHA256SUMS.asc` signed by a test key + test key in a scratch keyring + all artifacts present → exit 0, ✅ output per artifact.
  - Case B: tampered `SHA256SUMS` (one line's hash flipped) → exit 1, output names failing file.
  - Case C: `SHA256SUMS.asc` signed by an untrusted key → exit 1, output mentions signature failure.
  - Case D: `--no-fetch` with missing `SHA256SUMS` in cwd → exit 2 with clear error.
  - Case E: `--fingerprint` override honored (test against alternate key).
  - Each test uses a scratch `GNUPGHOME` under `tmpdir` to avoid leaking into the user's real keyring.

- **PowerShell equivalent**: a parallel test file using Pester or `bun test` + `pwsh` subprocess. Decision between Pester vs. Bun-driven is deferred to the implementation plan (tool choice, not architecture).

### 7.2 Integration / end-to-end

- **`scripts/ci/verify-release-dry-run.sh`** (new, referenced in §8): maintainer-invoked after tagging `v0.1.0-rc1`. Downloads all release assets via `gh release download`, runs `nimbus-verify.sh --version v0.1.0-rc1 --no-fetch` (files are already local), asserts exit 0. Also asserts presence of the expected artifact set from §3.2.
- **`release.yml` itself** acts as the integration test once `v0.1.0-rc1` is tagged — a green end-to-end run **is** the smoke test. Specific post-run checks (documented in the `implementation plan`, not here):
  - GitHub Release page lists `SHA256SUMS` + `SHA256SUMS.asc` + every artifact from §3.2.
  - `publish-release` + `update-manifest` both paused for approval in the Actions UI.
  - Ed25519-signed `latest.json` is uploaded after approval of `update-manifest`.

### 7.3 Manual smoke — rc1 dry-run

Executed by the maintainer before tagging `v0.1.0` final, on three clean VMs:

1. **macOS x64 + arm64.** Download the matching binary + `SHA256SUMS` + `SHA256SUMS.asc`. Run `bash nimbus-verify.sh --version v0.1.0-rc1`. Confirm ✅. Follow `docs/install-macos-unsigned.md` Finder workflow (right-click → Open → "Open anyway"). Confirm Gateway launches.
2. **Windows 11.** Same with `nimbus-verify.ps1`. Follow `docs/install-windows-unsigned.md`. Click through SmartScreen.
3. **Ubuntu 22.04.** Install `.deb` via `sudo dpkg -i`. Also launch the `.AppImage` directly (`chmod +x; ./…`). Run `dpkg-sig --verify` on the `.deb` — confirm valid GPG signature.
4. On every platform: `gpg --verify SHA256SUMS.asc SHA256SUMS && sha256sum -c SHA256SUMS` manually — confirms the path documented in `verify-release-integrity.md`.
5. Verify `environment: release` pause-for-approval is observed in the Actions UI by looking at the rc1 workflow run history.

Results recorded inline in the implementation plan's final-verification task (and/or in a committed `docs/release/v0.1.0-rc1-smoke.md` if that file is within scope when the plan is written).

### 7.4 Coverage gates

No gateway / UI / SDK source changes in Phase 1 → existing coverage thresholds in `CLAUDE.md` untouched. Unit-test coverage for the two new scripts is informational; no CI gate.

---

## 8. Acceptance Criteria (spec-level)

These copy forward into the implementation plan's Final Verification section and into `v0.1.0-finish-plan.md §4.2`'s acceptance-criteria checklist.

- [ ] `release.yml` runs green end-to-end on a `v0.1.0-rc1` tag with `GPG_SIGNING_SUBKEY` + `GPG_PASSPHRASE` + `UPDATER_ED25519_PRIVATE_KEY` + `RELEASE_PAT` populated. No Apple / Windows cert secrets referenced anywhere.
- [ ] Release assets on the `v0.1.0-rc1` page include: raw binaries for Linux / macOS-x64 / macOS-arm64 / Windows for both `nimbus-gateway` and `nimbus-cli`; `nimbus-headless_<ver>_amd64.deb` + `.asc`; `nimbus-headless-<ver>-x86_64.AppImage` + `.asc`; `nimbus-headless-linux-amd64.tar.gz` + `.asc`; `nimbus-headless-macos-x64.tar.gz`; `nimbus-headless-macos-arm64.tar.gz`; `nimbus-headless-windows-x64.zip`; `nimbus-<ver>-sbom.cdx.json`; `SHA256SUMS`; `SHA256SUMS.asc`; `nimbus-verify.sh`; `nimbus-verify.ps1`; `latest.json`.
- [ ] `gpg --verify SHA256SUMS.asc SHA256SUMS && sha256sum -c --ignore-missing SHA256SUMS` succeeds on a clean machine for the downloaded artifact subset (verified on all three OSes).
- [ ] `nimbus-verify.sh --version v0.1.0-rc1` exits 0 on Linux + macOS against a downloaded subset.
- [ ] `nimbus-verify.ps1 --version v0.1.0-rc1` exits 0 on Windows against a downloaded subset.
- [ ] `docs/install-macos-unsigned.md` Finder workflow successfully launches the binary on a fresh macOS install (x64 + arm64) — both unwrapped from `.tar.gz` with `+x` bit preserved.
- [ ] `docs/install-windows-unsigned.md` SmartScreen workflow successfully launches the binary on a fresh Windows 11 install, unwrapped from `.zip` via Windows "Extract All".
- [ ] `.deb` installs cleanly on a fresh Ubuntu 22.04 install and `dpkg-sig --verify` reports a valid signature.
- [ ] `.AppImage` is executable on Ubuntu 22.04 with `libfuse2` present, **and** on Ubuntu 24.04 / Fedora 40 via `--appimage-extract-and-run`. Both paths documented in the install docs.
- [ ] `docs/SECURITY.md` lists the production GPG fingerprint, and the same fingerprint appears in `nimbus-verify.sh`'s `TRUSTED_FINGERPRINTS` array and in `README.md` — three-way consistency verified by a CI check.
- [ ] `publish-release` and `update-manifest` both pause on the Actions UI pending maintainer approval; rejecting halts the release cleanly with no partial upload.
- [ ] `scripts/sign-macos.sh` + `scripts/sign-windows.ps1` are removed; `grep -r "sign-macos\.sh\|sign-windows\.ps1"` over the repo returns zero hits.
- [ ] `docs/release/v0.1.0-prerequisites.md §9.5` secrets table lists exactly: `GPG_SIGNING_SUBKEY`, `GPG_PASSPHRASE`, `UPDATER_ED25519_PRIVATE_KEY`, `VSCE_PAT`, `OVSX_PAT`, `NPM_TOKEN`, `RELEASE_PAT`.
- [ ] `README.md` has an `## Install` section with Linux / macOS / Windows subsections + a "Verify any download" subsection linking to `docs/verify-release-integrity.md`.

---

## 9. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `appimagetool` upstream version rotation breaks the SHA pin | Low–Medium | Pin via SHA-256 constant; update requires a deliberate commit that re-verifies the new version's fingerprint via the AppImage project's own signing. Document the update process in a one-screen `scripts/linux/README.md`. |
| `libfuse2` removed from Ubuntu 22.04 package repo | Low | Ubuntu 22.04 LTS supported through 2027; if removed, pin runner image to the last image shipping it, or switch to `appimagetool --appimage-extract-and-run` workaround. |
| Users skip `nimbus-verify` and install corrupted binaries | Medium | Install docs open with the verify step; README install subsections lead with "Power-User Shortcut" that includes verification. We cannot force verification; documentation + one-liner convenience are our levers. |
| `SHA256SUMS` filename collision across tracks when Phase 2 (UI) lands | N/A (Phase 2 concern) | Phase 2 spec decides: one unified manifest vs. `SHA256SUMS-ui`. Flag this forward in the Phase 2 brainstorm. |
| `release` environment not created before tagging | Medium (operational) | Plan's Task 1 asserts `gh api …/environments/release` returns non-empty `protection_rules` before any tag is pushed. Hard-fail if unconfigured. |
| `RELEASE_PAT` expires silently | Low | `release.yml` already has a "Require release PAT" check; will fail loud at the publish step. Document rotation cadence in prerequisites §9.5. |
| Placeholder `docs/release/SIGNING-KEY.asc` accidentally shipped as if real | Low | Placeholder file starts with `PLACEHOLDER-DO-NOT-USE` sentinel; CI check (new, lightweight) greps release assets for that sentinel and fails the publish step if present. Covered in the implementation plan. |
| User runs `nimbus-verify` on macOS without GPG installed | Medium | Script checks for `gpg` on startup; exits 2 with install hint (`brew install gnupg`). Cross-linked from `install-macos-unsigned.md`. |
| User's distro has `gpg2` instead of `gpg` | Low | Script probes for `gpg` then `gpg2`; documents fallback in `verify-release-integrity.md`. |

---

## 10. Open Items Deferred to the Implementation Plan

These are small enough to resolve during TDD cycles and don't affect the architecture:

1. **Pester vs. Bun-driven test runner for `nimbus-verify.ps1`** — tooling preference. Both satisfy the test contract.
2. **Exact icon file for `nimbus-headless.png`** — a placeholder icon is acceptable at spec merge time; the UI design pass will provide a real icon in a follow-up commit.
3. **Exact `appimagetool` version pin** — pick the latest stable at plan-writing time; record SHA-256 in the script.
4. **CI check for the `PLACEHOLDER-DO-NOT-USE` sentinel in `SIGNING-KEY.asc`** — one grep step in `release.yml` or a pre-publish script. Implementation detail.
5. **Exact wording of the "Why unsigned?" framing paragraph** across the three install docs — three paragraph variations are fine; no DRY abstraction needed for three callsites.

---

## 11. Handoff

This spec is the authoritative input to the Phase 1 implementation plan. Next step: invoke `superpowers:writing-plans` to turn this into a task-by-task TDD plan at `docs/superpowers/plans/2026-04-23-signing-pipeline.md`.

**After Phase 1 ships:** open a new brainstorm for the Phase 2 Tauri UI track spec. Cross-reference this spec from that one's §1.

---

## 12. Review Responses (Gemini CLI review, 2026-04-23)

Reviewer feedback from `docs/superpowers/specs/2026-04-23-signing-pipeline-review.md`. Each point addressed as **fixed inline** (with a pointer to the section that changed) or **deferred** (with a reason). The design-doc text above was revised to absorb every accepted fix before the plan was written.

### Fixed inline

- **Q1 (Bootstrap Trust) + S3 (Central Security Truth).** Fingerprint now published in **four** out-of-band places: two keyservers, `docs/SECURITY.md` (new human-readable section), and `docs/release/SIGNING-KEY.asc` (key body). Verify scripts **print the imported fingerprint** before verifying, so first-time users cross-check against `SECURITY.md` / README / keyservers. If the four diverge: stop, open a security issue. §3.1 chain diagram rewritten; §3.5 bootstrap paragraph added; §8 adds a three-way consistency acceptance check; §4.2 adds `docs/SECURITY.md` to the modify list.

- **Q2 (Key Rotation).** Scripts now carry a `TRUSTED_FINGERPRINTS` **array** (not a single constant). Verification passes if the signature's fingerprint matches any array entry. Rotation is a documented three-release procedure (dual-fingerprint release → new-key-only release), worked example in `docs/verify-release-integrity.md`. §3.5 "Key rotation" paragraph rewritten. `--fingerprint` flag accepts comma-separated values for manual overrides.

- **Q4 (Browser Safe Browsing) + S1 (Archives for macOS/Windows).** Accepted and applied. macOS x64 + arm64 ship as `.tar.gz` (preserves `+x`); Windows ships as `.zip` (conventional; fewer browser warnings). Each archive also bundles `README-QUICKSTART.txt` + `LICENSE-AGPL.txt`. Raw binaries continue to ship alongside for the auto-updater's byte-stable download path. §2.1 item 3, §3.2 table + rationale, §3.7.3 new step 2, §4.1 (two new committed assets), §5 data flow, §8 acceptance criteria all updated. The original rationale ("bun-build is already single-file, no zip wrapper needed") underweighted the browser-UX and `+x`-bit-stripping issues; reviewer is right.

- **S2 (`--check-only` mode).** Partial fix: the existing `--no-fetch` flag already serves the "don't download, verify what's local" use case S2 describes. Rather than add a redundant flag, the spec now documents `--no-fetch` as the canonical offline/CI verification mode in §3.5 — one concept, one flag, clearer docs. If user feedback shows `--check-only` is a more discoverable name post-ship, it can be added as an alias without design-level change.

- **S4 (AppImage Terminal=true / File-Manager UX).** Acknowledged. The `.desktop` file will carry `Terminal=true` (original plan). Install docs will note that the AppImage is **primarily intended for shell invocation** (`./nimbus-headless.AppImage` from a terminal) and that File-Manager double-click behavior depends on the user's DE — some DEs open a terminal automatically on `Terminal=true`, others don't. Users who want File-Manager double-click-with-terminal should install `AppImageLauncher`. This is a DE-level behavior we can't fix at packaging time; documentation is the right lever. §3.6 + install-doc outlines updated.

- **Q3 user-side (libfuse2 portability).** Fixed in §3.6: the spec now documents the two user paths on libfuse2-less distros (Ubuntu 24.04+, Fedora 40+, Arch) — `apt install libfuse2t64` **or** `./nimbus-headless.AppImage --appimage-extract-and-run`. Both documented in README and install docs. §8 acceptance criteria adds an Ubuntu 24.04 / Fedora 40 `--appimage-extract-and-run` verification row.

- **I2 (`LC_ALL=C sort`).** Fixed in §3.3 and §3.7.3 step 4. `sha256sum` output is also run under `LC_ALL=C` for good measure; together they guarantee byte-identical `SHA256SUMS` across runner images.

- **I3 (distinctive placeholder icon).** Fixed in §3.6: "Use a distinctive CLI-themed placeholder (terminal-prompt glyph style), not a generic gear / cloud / blank shape."

### Already addressed in the original spec (reviewer reinforced, no new change)

- **I1 (Isolated `GNUPGHOME` for tests).** §7.1 already specifies: "Each test uses a scratch `GNUPGHOME` under `tmpdir` to avoid leaking into the user's real keyring." Reviewer feedback reinforces this is the right approach; no edit needed.

- **Q3 CI-side (libfuse2 on newer Ubuntu runners).** `release.yml` already pins every job to `ubuntu-22.04` explicitly (not `ubuntu-latest`). §3.6 now documents this pin choice and the 2027 support horizon; if GitHub retires the 22.04 runner before we switch the pin, `appimagetool --appimage-extract-and-run` is the drop-in fallback.

### Deferred

- **Q5 (ARM64 Linux AppImage).** Reviewer's premise is incorrect: `release.yml` today does **not** build `nimbus-gateway-linux-arm64` — the Linux matrix has x64 only. Adding ARM64 Linux requires: (a) confirming GitHub's `ubuntu-22.04-arm` runner tier is available and cost-acceptable; (b) building gateway + CLI on ARM64 with the embedding model prepackaged (MiniLM ONNX weights must be ARM64-validated); (c) extending `package-linux-installers.ts` to emit an ARM64 `.deb` + `.AppImage`; (d) signing those on the ARM64 runner. This is a **Phase 5+ workstream**, not a v0.1.0 concern. Tracked as a follow-up in §2.4 non-goals. Changing this would derail the Phase 1 scope agreed in brainstorm Q1–Q4.

### Meta

The review caught two genuine design errors (Q1 bootstrap trust, Q4 browser behavior) and four solid hardening nudges (Q2 rotation array, S4 AppImage DE UX, I2 locale, I3 icon). Accepting all of them expanded the spec by ~70 lines but tightened the trust story meaningfully. Worth the read.
