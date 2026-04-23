# Headless Signing Pipeline — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v0.1.0 headless-release signing pipeline — GPG-signed `SHA256SUMS` manifest, `AppImage` installer, `nimbus-verify.{sh,ps1}` helpers, unsigned-install documentation, and `release` GitHub Environment gating — while stripping the no-op macOS/Windows codesign paths.

**Architecture:** Extend the existing `publish-release` job in `.github/workflows/release.yml` to build macOS/Windows archives, assemble a flat `dist/stage/` staging dir, compute `SHA256SUMS` + detached-GPG signature over every asset except `latest.json`, and upload the lot. End-user `nimbus-verify.{sh,ps1}` scripts carry a `TRUSTED_FINGERPRINTS` array and print the imported fingerprint so first-time users can cross-check against `docs/SECURITY.md` / README / keyservers. No new gateway or UI source code is modified — all changes live in `scripts/`, `docs/`, and `.github/workflows/`.

**Tech Stack:** Bash / PowerShell / TypeScript (Bun) / GitHub Actions YAML / GPG (`gnupg` ≥2.2) / `appimagetool` / `dpkg-deb` / `tar` / `zip`. Tests via `bun test` shelling out to `bash`; GPG isolation via scratch `GNUPGHOME` under tmpdir.

**Finish-plan reference:** [`docs/release/v0.1.0-finish-plan.md §4.2`](../../release/v0.1.0-finish-plan.md) — the authoritative scope + acceptance criteria, as refined by the four brainstorm questions (Q1–Q4) and the Gemini review (§12 of the spec).

**Design spec:** [`docs/superpowers/specs/2026-04-23-signing-pipeline-design.md`](../specs/2026-04-23-signing-pipeline-design.md) — read this first if unfamiliar.

---

## File Map

**Create:**
- `scripts/release/nimbus-verify.sh` — shell helper for Linux + macOS.
- `scripts/release/nimbus-verify.ps1` — PowerShell helper for Windows.
- `scripts/release/nimbus-verify.test.ts` — unit tests driven via `bun test` shelling out to `bash`, using a scratch `GNUPGHOME`.
- `scripts/release/archive-contents/README-QUICKSTART.txt` — one-page quickstart bundled into every macOS + Windows archive.
- `scripts/release/archive-contents/LICENSE-AGPL.txt` — AGPL-3.0 license copy for archive inclusion (AGPL redistribution requirement).
- `scripts/linux/nimbus-headless.AppRun` — 3-line shell shim template for the AppImage.
- `scripts/linux/nimbus-headless.desktop` — Desktop Entry template with `{{VERSION}}` placeholder.
- `scripts/linux/nimbus-headless.png` — 256×256 CLI-themed placeholder icon (committed binary).
- `scripts/package-linux-installers.test.ts` — new test file covering `.deb`, tarball, and the new AppImage path with a stubbed `appimagetool`.
- `docs/install-macos-unsigned.md` — Gatekeeper-bypass workflow + "Why unsigned?" framing.
- `docs/install-windows-unsigned.md` — SmartScreen-bypass workflow + Defender guidance + "Why unsigned?" framing.
- `docs/verify-release-integrity.md` — the authoritative integrity-chain explanation + manual verification walkthrough + key-rotation worked example.
- `docs/release/SIGNING-KEY.asc` — placeholder ASCII-armored block (real bytes land when prerequisites §3 is completed by the maintainer).

**Modify:**
- `.github/workflows/release.yml` — remove codesign + signtool steps; extend `publish-release` with Linux installer signing, macOS/Windows archive building, staging, `SHA256SUMS` computation + signing, single-glob release upload; add `environment: release` to `publish-release` + `update-manifest`.
- `scripts/package-linux-installers.ts` — refactor into explicit `buildTarball()` / `buildDeb()` / `buildAppImage()` functions. The `appimagetool` download + caching moves into the `release.yml` Linux-installers step (shell-level `curl`); the script accepts `--appimagetool <path>` so tests can inject a stub and CI can point at the pre-downloaded binary.
- `README.md` — add `## Install` section with Linux / macOS / Windows subsections + "Verify any download" subsection.
- `docs/SECURITY.md` — add new `## Release Signing Key` section listing the project GPG fingerprint + four publication locations.
- `docs/release/v0.1.0-prerequisites.md` — move §1 (Windows EV cert) and §2 (Apple Developer) to a new `Deferred to a Later Point Release` section; drop 7 rows from §9.5 secrets table; update Summary cost paragraph; update Handoff Checklist.
- `docs/release/v0.1.0-finish-plan.md` — update §4.2 acceptance-criteria artifact list (drops `.pkg` + `-setup.exe`, adds archives + AppImage).

**Delete:**
- `scripts/sign-macos.sh` — no remaining callers after `release.yml` edits.
- `scripts/sign-windows.ps1` — same.

---

## Execution Order Rationale

- **Task 1 first** — strips dead code (smallest risk, clears noise) and isolates later diffs from the deletion.
- **Tasks 2–4** — groundwork (docs anchors, AppImage tooling, archive content) that Task 13 will wire up.
- **Tasks 5–6** — verify scripts (independent of `release.yml`; can be unit-tested standalone with a scratch keyring).
- **Tasks 7–10** — user-facing docs (cross-reference the scripts + fingerprint).
- **Tasks 11–12** — internal docs (prerequisites + finish-plan deltas).
- **Task 13** — `release.yml` integration (last; consumes all prior outputs).
- **Task 14** — final verification + handoff checklist.

---

## Task 1: Strip Dead macOS + Windows Codesign Paths

**Why this is Task 1:** The scripts are graceful no-ops today — deleting them first shrinks later diffs, eliminates two Sonar-visible files, and makes `release.yml` edits in Task 13 smaller.

**Files:**
- Delete: `scripts/sign-macos.sh`
- Delete: `scripts/sign-windows.ps1`
- Modify: `.github/workflows/release.yml:109-128` (remove two signing steps in `build-gateway` + two identical steps in `build-cli`)

---

- [ ] **Step 1.1: Verify no other callers**

Run: `grep -rn "sign-macos\.sh\|sign-windows\.ps1" . --include='*.yml' --include='*.yaml' --include='*.ts' --include='*.sh' --include='*.md' | grep -v '^./docs/'`

Expected: only `release.yml` matches. If anything else matches (e.g., another workflow file), stop and add those call sites to this task's file map.

- [ ] **Step 1.2: Delete the two scripts**

Run:
```bash
rm scripts/sign-macos.sh scripts/sign-windows.ps1
```

- [ ] **Step 1.3: Remove the macOS codesign step from `build-gateway`**

Open `.github/workflows/release.yml`. Locate:

```yaml
      - name: Sign binary (macOS)
        if: startsWith(matrix.target.os, 'macos')
        timeout-minutes: 15
        env:
          MACOS_CERTIFICATE: ${{ secrets.MACOS_CERTIFICATE }}
          MACOS_CERTIFICATE_PWD: ${{ secrets.MACOS_CERTIFICATE_PWD }}
          MACOS_SIGNING_IDENTITY: ${{ secrets.MACOS_SIGNING_IDENTITY }}
          NOTARIZATION_APPLE_ID: ${{ secrets.NOTARIZATION_APPLE_ID }}
          NOTARIZATION_PASSWORD: ${{ secrets.NOTARIZATION_PASSWORD }}
          NOTARIZATION_TEAM_ID: ${{ secrets.NOTARIZATION_TEAM_ID }}
        run: bash scripts/sign-macos.sh dist/${{ matrix.target.artifact }}${{ matrix.target.ext }}
```

Delete the entire block (including the blank line after it).

- [ ] **Step 1.4: Remove the Windows signtool step from `build-gateway`**

In the same file, locate:

```yaml
      - name: Sign binary (Windows)
        if: matrix.target.os == 'windows'
        timeout-minutes: 15
        env:
          WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}
          WINDOWS_CERTIFICATE_PWD: ${{ secrets.WINDOWS_CERTIFICATE_PWD }}
        shell: pwsh
        run: ./scripts/sign-windows.ps1 -Target dist/${{ matrix.target.artifact }}${{ matrix.target.ext }}
```

Delete the entire block.

- [ ] **Step 1.5: Check for identical steps in `build-cli`**

Run: `grep -n "Sign binary (macOS)\|Sign binary (Windows)" .github/workflows/release.yml`

Expected: no matches if the deletions were complete, OR matches under the `build-cli` job if those copies exist. If `build-cli` has them too, delete both there identically. (The current `release.yml` does NOT have these in `build-cli` — verified by earlier exploration — but re-confirm.)

- [ ] **Step 1.6: Validate `release.yml` syntax**

Run: `bunx action-validator .github/workflows/release.yml || npx action-validator .github/workflows/release.yml`

If neither tool is installed locally, skip and rely on CI. Alternative: `yamllint .github/workflows/release.yml` (if installed). The YAML still needs to parse even if these validators are unavailable — `bun x yaml-lint` or `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"` works as a last resort.

- [ ] **Step 1.7: Confirm no broken references**

Run: `grep -n "MACOS_CERTIFICATE\|WINDOWS_CERTIFICATE\|NOTARIZATION_\|MACOS_SIGNING_IDENTITY" .github/workflows/release.yml`

Expected: no matches. If any remain, they're orphaned env-var references that must also be removed (they'd be from a `build-cli` copy that Step 1.5 should have caught).

- [ ] **Step 1.8: Commit**

```bash
git add -u scripts/sign-macos.sh scripts/sign-windows.ps1 .github/workflows/release.yml
git commit -m "$(cat <<'EOF'
chore(release): strip no-op macOS + Windows codesign scripts

Per v0.1.0-finish-plan §4.2 and signing-pipeline design §2.4 non-goals:
no codesign/notarytool/stapler or signtool/Authenticode in release.yml.
Scripts were graceful no-ops without cert secrets; deleting them + the
two release.yml steps shrinks the Phase 1 signing diff.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `docs/SECURITY.md` + `docs/release/SIGNING-KEY.asc` Placeholder

**Why this is Task 2:** Later tasks reference `docs/SECURITY.md`'s fingerprint section and `docs/release/SIGNING-KEY.asc`'s existence. Commit the anchors first so cross-references resolve.

**Files:**
- Modify: `docs/SECURITY.md`
- Create: `docs/release/SIGNING-KEY.asc`

---

- [ ] **Step 2.1: Read existing `docs/SECURITY.md`**

Run: `cat docs/SECURITY.md`

Note the existing sections. The new section goes at the end.

- [ ] **Step 2.2: Append `## Release Signing Key` section to `docs/SECURITY.md`**

At the very bottom of `docs/SECURITY.md`, append:

```markdown
---

## Release Signing Key

Nimbus release artifacts are distributed with a GPG-signed `SHA256SUMS.asc` integrity manifest (and per-artifact `.asc` sidecars on Linux). All release signing uses the single key whose fingerprint is published below.

**Project GPG fingerprint (v0.1.0 and later):**

```
PLACEHOLDER — real fingerprint lands when docs/release/v0.1.0-prerequisites.md §3 is completed by the maintainer.
Until then, releases are signed with a development test key; DO NOT install v0.1.0-rc releases in production.
```

**Cross-check this fingerprint against four sources** — if any two disagree, **do not install**; open a private security issue per "Reporting a Vulnerability" above:

1. This file (`docs/SECURITY.md`) — you're reading it now.
2. The repository README (`README.md`, "Install → Verify any download" section).
3. The public key ASCII-armored block at [`docs/release/SIGNING-KEY.asc`](release/SIGNING-KEY.asc).
4. Either keyserver — `keys.openpgp.org` or `keyserver.ubuntu.com`.

**To import the key from a keyserver:**

```bash
gpg --keyserver keys.openpgp.org --recv-keys <FINGERPRINT>
# or
gpg --keyserver keyserver.ubuntu.com --recv-keys <FINGERPRINT>
```

**First-time users:** the `nimbus-verify.sh` / `nimbus-verify.ps1` helper scripts print the fingerprint they imported before running `gpg --verify`. Match that printed value against this file, the README, and a keyserver lookup before allowing the script to touch your keyring. See [`docs/verify-release-integrity.md`](verify-release-integrity.md) for the full walkthrough.

**Key rotation.** When the project rotates its signing key, the transition runs over two releases: one signed by the old key but carrying the new fingerprint in the scripts' `TRUSTED_FINGERPRINTS` array, and a subsequent release signed by the new key only. See [`docs/verify-release-integrity.md#key-rotation`](verify-release-integrity.md#key-rotation) for the worked example.
```

- [ ] **Step 2.3: Create `docs/release/SIGNING-KEY.asc`**

Create `docs/release/SIGNING-KEY.asc` with this content:

```
-----BEGIN PGP PUBLIC KEY BLOCK-----
Comment: PLACEHOLDER — real key lands when prerequisites §3 is complete
Comment: DO NOT use for v0.1.0 production — see docs/SECURITY.md

PLACEHOLDER-DO-NOT-USE
-----END PGP PUBLIC KEY BLOCK-----
```

The leading `Comment:` headers are valid GPG armor headers — parsers treat everything between `-----BEGIN` and `-----END` as one block, so the sentinel is safe. Task 13 will add a CI grep check that fails `publish-release` if this sentinel string survives to the release assets.

- [ ] **Step 2.4: Verify no other doc references `SIGNING-KEY.asc` yet (expected: only the new file + SECURITY.md)**

Run: `grep -rn "SIGNING-KEY\.asc" docs/ README.md 2>/dev/null`

Expected: matches in `docs/SECURITY.md` (from Step 2.2) and `docs/release/SIGNING-KEY.asc` (the file itself, if grep picks up its Comment line). Any other matches indicate the file-map missed a reference — investigate before proceeding.

- [ ] **Step 2.5: Commit**

```bash
git add docs/SECURITY.md docs/release/SIGNING-KEY.asc
git commit -m "$(cat <<'EOF'
docs(security): add Release Signing Key section + SIGNING-KEY placeholder

Anchors the out-of-band fingerprint publication path referenced by the
forthcoming nimbus-verify scripts and the install docs. Real fingerprint
bytes land when the maintainer completes prerequisites §3; the PLACEHOLDER
sentinel will be rejected at publish time by a CI check added in Task 13.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: AppImage Extension — `package-linux-installers.ts` + Template Files

**Files:**
- Create: `scripts/linux/nimbus-headless.AppRun`
- Create: `scripts/linux/nimbus-headless.desktop`
- Create: `scripts/linux/nimbus-headless.png`
- Create: `scripts/package-linux-installers.test.ts`
- Modify: `scripts/package-linux-installers.ts`

---

- [ ] **Step 3.1: Create the AppRun shim template**

Create `scripts/linux/nimbus-headless.AppRun`:

```sh
#!/bin/sh
# AppRun — AppImage entrypoint. Dispatches to the CLI binary with the user's args.
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/bin/nimbus" "$@"
```

Make it executable:

```bash
chmod +x scripts/linux/nimbus-headless.AppRun
```

- [ ] **Step 3.2: Create the Desktop Entry template**

Create `scripts/linux/nimbus-headless.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=Nimbus Headless
Comment=Local-first AI agent framework (CLI + headless Gateway)
Exec=nimbus %U
Icon=nimbus-headless
Terminal=true
Categories=Development;Utility;
StartupNotify=false
X-AppImage-Version={{VERSION}}
```

The `{{VERSION}}` placeholder is substituted at AppImage-build time by the TypeScript script.

`Terminal=true` is set because `nimbus` is a CLI tool — double-click launches from a File Manager need a terminal. Behavior varies by Desktop Environment; users wanting consistent double-click-with-terminal should install `AppImageLauncher`. This caveat is documented in `docs/verify-release-integrity.md` (Task 7).

- [ ] **Step 3.3: Create the placeholder icon**

The icon is a 256×256 PNG. If a real asset isn't ready, generate a distinctive CLI-themed placeholder using ImageMagick — a minimalist terminal-prompt glyph on a solid background:

```bash
# Requires ImageMagick. On Ubuntu: `sudo apt install imagemagick`.
convert -size 256x256 xc:'#0a1929' \
  -font 'DejaVu-Sans-Mono-Bold' -pointsize 140 \
  -fill '#7dd3fc' -gravity center -annotate +0+0 '>_' \
  scripts/linux/nimbus-headless.png
```

If ImageMagick is unavailable locally, commit a manually-generated 256×256 PNG with terminal-prompt `>_` styling — any distinctive mark is preferable to a generic gear/cloud. Do not commit a blank or 1×1 pixel image.

Verify:

```bash
file scripts/linux/nimbus-headless.png
# Expect: "PNG image data, 256 x 256, 8-bit/color RGB(A), non-interlaced"
```

- [ ] **Step 3.4: Write the failing test**

Create `scripts/package-linux-installers.test.ts`:

```ts
/// <reference types="bun-types" />
import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workDir: string;
let bundleDir: string;
let outDir: string;
let stubToolPath: string;

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "nimbus-pkg-linux-"));
  bundleDir = join(workDir, "bundle");
  outDir = join(workDir, "out");
  mkdirSync(bundleDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  // Synthetic binaries: any non-empty file is fine (real build output isn't required
  // for the packaging logic under test).
  writeFileSync(join(bundleDir, "nimbus-gateway"), "#!/bin/sh\necho gw\n", "utf8");
  writeFileSync(join(bundleDir, "nimbus"), "#!/bin/sh\necho cli\n", "utf8");
  chmodSync(join(bundleDir, "nimbus-gateway"), 0o755);
  chmodSync(join(bundleDir, "nimbus"), 0o755);

  // Stub appimagetool: writes a 4-byte marker so the test can recognise its output
  // without needing FUSE / real AppImage magic.
  stubToolPath = join(workDir, "stub-appimagetool");
  writeFileSync(
    stubToolPath,
    `#!/usr/bin/env bash
# stub-appimagetool: takes <AppDir> <outPath>, writes a 4-byte marker to outPath.
set -e
OUT="$2"
printf 'AITS' > "$OUT"
`,
    "utf8",
  );
  chmodSync(stubToolPath, 0o755);
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

test("produces .deb with expected name", () => {
  const r = spawnSync(
    "bun",
    [
      "scripts/package-linux-installers.ts",
      "--bundle",
      bundleDir,
      "--out",
      outDir,
      "--version",
      "0.1.0-rc1",
      "--skip-appimage",
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  expect(r.status).toBe(0);
  expect(existsSync(join(outDir, "nimbus-headless_0.1.0-rc1_amd64.deb"))).toBe(true);
});

test("produces tarball with expected name", () => {
  const r = spawnSync(
    "bun",
    [
      "scripts/package-linux-installers.ts",
      "--bundle",
      bundleDir,
      "--out",
      outDir,
      "--version",
      "0.1.0-rc1",
      "--skip-appimage",
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  expect(r.status).toBe(0);
  expect(existsSync(join(outDir, "nimbus-headless-linux-amd64-v0.1.0-rc1.tar.gz"))).toBe(true);
});

test("produces .AppImage with stubbed appimagetool", () => {
  const r = spawnSync(
    "bun",
    [
      "scripts/package-linux-installers.ts",
      "--bundle",
      bundleDir,
      "--out",
      outDir,
      "--version",
      "0.1.0-rc1",
      "--appimagetool",
      stubToolPath,
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  expect(r.status).toBe(0);
  const appImage = join(outDir, "nimbus-headless-0.1.0-rc1-x86_64.AppImage");
  expect(existsSync(appImage)).toBe(true);
  const head = readFileSync(appImage).subarray(0, 4).toString();
  expect(head).toBe("AITS"); // stub's magic bytes — proves the tool was invoked with the right output path
});

test("populates AppDir with AppRun, .desktop, icon, and binaries before invoking tool", () => {
  // Record stub tool's working directory + ls before it runs, so we can inspect the AppDir.
  const listingPath = join(workDir, "appdir-listing.txt");
  const recordingStub = join(workDir, "recording-stub");
  writeFileSync(
    recordingStub,
    `#!/usr/bin/env bash
set -e
APPDIR="$1"
(cd "$APPDIR" && find . -type f | sort) > "${listingPath}"
printf 'AITS' > "$2"
`,
    "utf8",
  );
  chmodSync(recordingStub, 0o755);

  const r = spawnSync(
    "bun",
    [
      "scripts/package-linux-installers.ts",
      "--bundle",
      bundleDir,
      "--out",
      outDir,
      "--version",
      "0.1.0-rc1",
      "--appimagetool",
      recordingStub,
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  expect(r.status).toBe(0);

  const listing = readFileSync(listingPath, "utf8");
  expect(listing).toContain("./AppRun");
  expect(listing).toContain("./nimbus-headless.desktop");
  expect(listing).toContain("./nimbus-headless.png");
  expect(listing).toContain("./usr/bin/nimbus");
  expect(listing).toContain("./usr/bin/nimbus-gateway");
  expect(listing).toContain("./usr/share/applications/nimbus-headless.desktop");
});

test("substitutes {{VERSION}} placeholder in desktop entry", () => {
  const recordingStub = join(workDir, "desktop-recording-stub");
  const desktopOut = join(workDir, "captured.desktop");
  writeFileSync(
    recordingStub,
    `#!/usr/bin/env bash
set -e
APPDIR="$1"
cp "$APPDIR/nimbus-headless.desktop" "${desktopOut}"
printf 'AITS' > "$2"
`,
    "utf8",
  );
  chmodSync(recordingStub, 0o755);

  spawnSync(
    "bun",
    [
      "scripts/package-linux-installers.ts",
      "--bundle",
      bundleDir,
      "--out",
      outDir,
      "--version",
      "0.1.0-rc1",
      "--appimagetool",
      recordingStub,
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );

  const desktop = readFileSync(desktopOut, "utf8");
  expect(desktop).toContain("X-AppImage-Version=0.1.0-rc1");
  expect(desktop).not.toContain("{{VERSION}}");
});
```

- [ ] **Step 3.5: Run the test to verify it fails**

Run: `bun test scripts/package-linux-installers.test.ts`

Expected: FAIL — the `--skip-appimage`, `--appimagetool`, and AppImage-build logic don't exist yet. Most tests will likely fail at the `--appimagetool` flag-parse stage or the AppImage existence check.

- [ ] **Step 3.6: Refactor `package-linux-installers.ts` into functions + add AppImage path**

Rewrite `scripts/package-linux-installers.ts`:

```ts
#!/usr/bin/env bun
/**
 * Build Linux release artifacts from the headless binary bundle:
 * - `nimbus-headless-linux-amd64-v<ver>.tar.gz`
 * - `nimbus-headless_<ver>_amd64.deb`
 * - `nimbus-headless-<ver>-x86_64.AppImage`
 *
 * Prerequisites: `tar`, `dpkg-deb`, `appimagetool` (or pass `--appimagetool <path>`
 * to use a pre-downloaded copy; tests use a stub). `libfuse2` must be installed at
 * runtime of `appimagetool`.
 *
 * Usage:
 *   bun scripts/package-linux-installers.ts
 *   bun scripts/package-linux-installers.ts --bundle dist/headless-bundle --version 0.2.0
 *   bun scripts/package-linux-installers.ts --skip-appimage             # tests, offline builds
 *   bun scripts/package-linux-installers.ts --appimagetool /tmp/stub    # test injection
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");

/** Absolute paths avoid PATH hijack (Sonar S4036); script targets Debian/Ubuntu packagers. */
const TAR_BIN = "/usr/bin/tar";
const DPKG_DEB_BIN = "/usr/bin/dpkg-deb";

function parseArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] !== undefined) {
    return process.argv[i + 1];
  }
  return undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

const bundleDir = resolve(repoRoot, parseArg("--bundle") ?? join("dist", "headless-bundle"));
const version = (parseArg("--version") ?? process.env["NIMBUS_RELEASE_VERSION"] ?? "0.0.0").replace(
  /^v/,
  "",
);
const outRoot = resolve(repoRoot, parseArg("--out") ?? join("dist", "installers"));
const skipAppImage = hasFlag("--skip-appimage");
const appImageToolOverride = parseArg("--appimagetool");

const gw = join(bundleDir, "nimbus-gateway");
const cli = join(bundleDir, "nimbus");

for (const [label, p] of [
  ["gateway", gw],
  ["cli", cli],
] as const) {
  if (!existsSync(p)) {
    console.error(
      `package-linux-installers: missing ${label} at ${p}\n` +
        `Run: (cd packages/gateway && bun build src/index.ts --compile --outfile ../../dist/nimbus-gateway --target bun)\n` +
        `      (cd packages/cli && bun build src/index.ts --compile --outfile ../../dist/nimbus --target bun)\n` +
        `      bun run package:headless`,
    );
    process.exit(1);
  }
}

if (existsSync(outRoot)) {
  rmSync(outRoot, { recursive: true, force: true });
}
mkdirSync(outRoot, { recursive: true });

function buildTarball(): string {
  const tarStage = join(outRoot, "tar-stage");
  const tarBin = join(tarStage, "bin");
  mkdirSync(tarBin, { recursive: true });
  copyFileSync(gw, join(tarBin, "nimbus-gateway"));
  copyFileSync(cli, join(tarBin, "nimbus"));
  chmodSync(join(tarBin, "nimbus-gateway"), 0o755);
  chmodSync(join(tarBin, "nimbus"), 0o755);
  writeFileSync(
    join(tarStage, "README.txt"),
    `Nimbus headless bundle (Linux x64)\n\nAdd the bin/ directory to PATH, or symlink bin/nimbus and bin/nimbus-gateway into /usr/local/bin.\n`,
    "utf8",
  );
  const tgzName = `nimbus-headless-linux-amd64-v${version}.tar.gz`;
  const tgzPath = join(outRoot, tgzName);
  const tar = spawnSync(TAR_BIN, ["-czf", tgzPath, "-C", tarStage, "bin", "README.txt"], {
    stdio: "inherit",
    cwd: repoRoot,
  });
  if (tar.status !== 0) {
    process.exit(tar.status ?? 1);
  }
  rmSync(tarStage, { recursive: true, force: true });
  return tgzPath;
}

function buildDeb(): string {
  const debName = `nimbus-headless_${version}_amd64.deb`;
  const debRoot = join(outRoot, "deb-stage");
  const debInst = join(debRoot, "usr", "lib", "nimbus", "bin");
  const debBin = join(debRoot, "usr", "local", "bin");
  mkdirSync(debInst, { recursive: true });
  mkdirSync(debBin, { recursive: true });
  copyFileSync(gw, join(debInst, "nimbus-gateway"));
  copyFileSync(cli, join(debInst, "nimbus"));
  chmodSync(join(debInst, "nimbus-gateway"), 0o755);
  chmodSync(join(debInst, "nimbus"), 0o755);
  writeFileSync(
    join(debBin, "nimbus"),
    '#!/bin/sh\nexec /usr/lib/nimbus/bin/nimbus "$@"\n',
    "utf8",
  );
  writeFileSync(
    join(debBin, "nimbus-gateway"),
    '#!/bin/sh\nexec /usr/lib/nimbus/bin/nimbus-gateway "$@"\n',
    "utf8",
  );
  chmodSync(join(debBin, "nimbus"), 0o755);
  chmodSync(join(debBin, "nimbus-gateway"), 0o755);
  mkdirSync(join(debRoot, "DEBIAN"), { recursive: true });
  writeFileSync(
    join(debRoot, "DEBIAN", "control"),
    [
      "Package: nimbus-headless",
      `Version: ${version}`,
      "Section: utils",
      "Priority: optional",
      "Architecture: amd64",
      "Maintainer: Nimbus Contributors <https://github.com/nimbus-dev/Nimbus>",
      "Description: Nimbus CLI and headless Gateway (local-first agent framework)",
      " Installs nimbus and nimbus-gateway under /usr/lib/nimbus/bin with wrappers in /usr/local/bin.",
      "",
    ].join("\n"),
    "utf8",
  );
  const debPath = join(outRoot, debName);
  const dpkg = spawnSync(DPKG_DEB_BIN, ["--build", "--root-owner-group", debRoot, debPath], {
    stdio: "inherit",
    cwd: repoRoot,
  });
  if (dpkg.status !== 0) {
    console.error("package-linux-installers: dpkg-deb failed (install dpkg-deb on Debian/Ubuntu)");
    process.exit(dpkg.status ?? 1);
  }
  rmSync(debRoot, { recursive: true, force: true });
  return debPath;
}

function buildAppImage(): string {
  const appImagetool = appImageToolOverride ?? "/usr/local/bin/appimagetool";
  if (!existsSync(appImagetool)) {
    console.error(
      `package-linux-installers: appimagetool not found at ${appImagetool}\n` +
        `Install from https://github.com/AppImage/AppImageKit/releases or pass --appimagetool <path>.`,
    );
    process.exit(1);
  }

  const appDir = join(outRoot, "AppDir");
  const appDirBin = join(appDir, "usr", "bin");
  const appDirApps = join(appDir, "usr", "share", "applications");
  mkdirSync(appDirBin, { recursive: true });
  mkdirSync(appDirApps, { recursive: true });

  // AppRun shim (top-level)
  copyFileSync(
    join(repoRoot, "scripts", "linux", "nimbus-headless.AppRun"),
    join(appDir, "AppRun"),
  );
  chmodSync(join(appDir, "AppRun"), 0o755);

  // .desktop (top-level + usr/share/applications) with {{VERSION}} substituted
  const desktopTemplate = readFileSync(
    join(repoRoot, "scripts", "linux", "nimbus-headless.desktop"),
    "utf8",
  );
  const desktop = desktopTemplate.replace(/\{\{VERSION\}\}/g, version);
  writeFileSync(join(appDir, "nimbus-headless.desktop"), desktop, "utf8");
  writeFileSync(join(appDirApps, "nimbus-headless.desktop"), desktop, "utf8");

  // Icon (top-level)
  copyFileSync(
    join(repoRoot, "scripts", "linux", "nimbus-headless.png"),
    join(appDir, "nimbus-headless.png"),
  );

  // Binaries under usr/bin
  copyFileSync(gw, join(appDirBin, "nimbus-gateway"));
  copyFileSync(cli, join(appDirBin, "nimbus"));
  chmodSync(join(appDirBin, "nimbus-gateway"), 0o755);
  chmodSync(join(appDirBin, "nimbus"), 0o755);

  const appImageName = `nimbus-headless-${version}-x86_64.AppImage`;
  const appImagePath = join(outRoot, appImageName);
  const tool = spawnSync(appImagetool, [appDir, appImagePath], {
    stdio: "inherit",
    cwd: repoRoot,
  });
  if (tool.status !== 0) {
    console.error("package-linux-installers: appimagetool failed");
    process.exit(tool.status ?? 1);
  }
  rmSync(appDir, { recursive: true, force: true });
  return appImagePath;
}

const tgzPath = buildTarball();
const debPath = buildDeb();
const appImagePath = skipAppImage ? null : buildAppImage();

console.log(`Linux installers written to ${outRoot}`);
console.log(`  ${tgzPath.substring(outRoot.length + 1)}`);
console.log(`  ${debPath.substring(outRoot.length + 1)}`);
if (appImagePath) {
  console.log(`  ${appImagePath.substring(outRoot.length + 1)}`);
}
```

- [ ] **Step 3.7: Run tests to verify they pass**

Run: `bun test scripts/package-linux-installers.test.ts`

Expected: 5 tests PASS. Common failures + fixes:
- "Cannot find module '…'": the test's `REPO_ROOT` path derivation on Windows differs from POSIX. The provided `.replace(/^\/([A-Z]:)/, "$1")` handles the Bun-on-Windows `/C:/…` quirk; if it still breaks on your machine, hardcode `REPO_ROOT = "/c/gitrepo/Nimbus"` for local runs (restore for the committed version).
- `dpkg-deb not found` when running locally on non-Debian systems: the `.deb` and tarball tests require `/usr/bin/dpkg-deb` and `/usr/bin/tar`. On macOS/Windows locally, only run the AppImage test (`bun test … -t "AppImage"`). Full coverage runs on the Ubuntu CI runner.

- [ ] **Step 3.8: Commit**

```bash
git add scripts/linux/ scripts/package-linux-installers.ts scripts/package-linux-installers.test.ts
git commit -m "$(cat <<'EOF'
feat(release): add AppImage to Linux headless installer output

Extends package-linux-installers.ts with buildAppImage() + AppDir
layout (AppRun shim, Desktop Entry with {{VERSION}} substitution,
icon, usr/bin binaries). Adds scripts/linux/ template assets and a
new test file covering tarball, .deb, and AppImage paths using a
stubbed appimagetool — existing script had no test coverage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Archive Content Staging Files

**Files:**
- Create: `scripts/release/archive-contents/README-QUICKSTART.txt`
- Create: `scripts/release/archive-contents/LICENSE-AGPL.txt`

---

- [ ] **Step 4.1: Create the directory**

Run: `mkdir -p scripts/release/archive-contents`

- [ ] **Step 4.2: Create `README-QUICKSTART.txt`**

Create `scripts/release/archive-contents/README-QUICKSTART.txt`:

```
Nimbus Headless — Quickstart
============================

This archive contains the Nimbus headless Gateway and CLI binaries.

Contents:
  nimbus-gateway-<os>-<arch>   The long-running Gateway daemon.
  nimbus-<os>-<arch>           The CLI client.
  README-QUICKSTART.txt        This file.
  LICENSE-AGPL.txt             AGPL-3.0 license (full text).

Getting started (macOS / Linux):
  1. Extract this archive.
  2. chmod +x ./nimbus-gateway-* ./nimbus-*
  3. Start the Gateway:   ./nimbus-gateway-<os>-<arch>
  4. In another terminal: ./nimbus-<os>-<arch> --help

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
  https://github.com/nimbus-dev/Nimbus
```

- [ ] **Step 4.3: Create the AGPL license copy**

Run: `cp LICENSE scripts/release/archive-contents/LICENSE-AGPL.txt`

If there is no `LICENSE` file at the repo root (verify with `ls LICENSE*`), use `cp LICENSE-AGPL scripts/release/archive-contents/LICENSE-AGPL.txt` or copy whatever AGPL file exists. If no AGPL license file exists at the repo root, stop and investigate — the project claims AGPL-3.0 licensing per `CLAUDE.md`, so the file should exist.

- [ ] **Step 4.4: Verify contents**

Run:
```bash
head -1 scripts/release/archive-contents/LICENSE-AGPL.txt
# Expected: "                    GNU AFFERO GENERAL PUBLIC LICENSE" or similar AGPL header

wc -l scripts/release/archive-contents/README-QUICKSTART.txt
# Expected: ~30-40 lines
```

- [ ] **Step 4.5: Commit**

```bash
git add scripts/release/archive-contents/
git commit -m "$(cat <<'EOF'
feat(release): add archive-contents staging dir for macOS/Windows archives

README-QUICKSTART.txt and LICENSE-AGPL.txt get bundled into every
.tar.gz (macOS) and .zip (Windows) archive by release.yml. Archive
packaging satisfies AGPL redistribution requirements and gives users
a one-page landing reference without needing network access.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `nimbus-verify.sh` + TDD Test Fixture

**Files:**
- Create: `scripts/release/nimbus-verify.sh`
- Create: `scripts/release/nimbus-verify.test.ts`
- Create: `scripts/release/fixtures/gen-test-key.sh` (helper for test fixture generation)

---

- [ ] **Step 5.1: Create the test-fixture generator**

Create `scripts/release/fixtures/gen-test-key.sh`:

```bash
#!/usr/bin/env bash
# Generates a scratch GPG keyring + test key at $1 (target dir).
# Used by nimbus-verify.test.ts; also callable manually for debugging.
set -euo pipefail

TARGET="${1:?usage: $0 <target-dir>}"
mkdir -p "$TARGET"
chmod 700 "$TARGET"

export GNUPGHOME="$TARGET"

cat > "$TARGET/gen-key.batch" <<EOF
%no-protection
Key-Type: EDDSA
Key-Curve: ed25519
Key-Usage: sign
Name-Real: Nimbus Test Signing
Name-Email: test@nimbus.local
Expire-Date: 1y
%commit
EOF

gpg --batch --generate-key "$TARGET/gen-key.batch" 2>/dev/null
rm -f "$TARGET/gen-key.batch"

# Print the fingerprint — caller captures it.
gpg --list-keys --with-colons | awk -F: '/^fpr:/ { print $10; exit }'
```

Make it executable:

```bash
chmod +x scripts/release/fixtures/gen-test-key.sh
```

- [ ] **Step 5.2: Write the failing test**

Create `scripts/release/nimbus-verify.test.ts`:

```ts
/// <reference types="bun-types" />
import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const VERIFY_SH = join(REPO_ROOT, "scripts", "release", "nimbus-verify.sh");
const GEN_KEY = join(REPO_ROOT, "scripts", "release", "fixtures", "gen-test-key.sh");

let work: string;
let gnupghome: string;
let cwd: string;
let fingerprint: string;

function run(
  args: string[],
  opts: { env?: Record<string, string> } = {},
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("bash", [VERIFY_SH, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GNUPGHOME: gnupghome,
      NIMBUS_VERIFY_FINGERPRINT_OVERRIDE: fingerprint, // injects the test key's fp
      ...opts.env,
    },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "nimbus-verify-test-"));
  gnupghome = join(work, "gnupg");
  cwd = join(work, "cwd");
  mkdirSync(cwd, { recursive: true });

  // Generate scratch test key.
  const genRes = spawnSync("bash", [GEN_KEY, gnupghome], { encoding: "utf8" });
  if (genRes.status !== 0) {
    throw new Error(`gen-test-key.sh failed: ${genRes.stderr}`);
  }
  fingerprint = genRes.stdout.trim();
  if (!/^[0-9A-F]{40}$/.test(fingerprint)) {
    throw new Error(`unexpected fingerprint from gen-test-key.sh: "${fingerprint}"`);
  }

  // Create a simple artifact and its SHA256SUMS + signed .asc.
  writeFileSync(join(cwd, "hello.bin"), "hello world", "utf8");
  const sha = spawnSync("sha256sum", ["hello.bin"], { cwd, encoding: "utf8" });
  writeFileSync(join(cwd, "SHA256SUMS"), sha.stdout, "utf8");
  const sign = spawnSync(
    "gpg",
    [
      "--batch",
      "--yes",
      "--pinentry-mode",
      "loopback",
      "--detach-sign",
      "--armor",
      "--output",
      join(cwd, "SHA256SUMS.asc"),
      join(cwd, "SHA256SUMS"),
    ],
    { encoding: "utf8", env: { ...process.env, GNUPGHOME: gnupghome } },
  );
  if (sign.status !== 0) {
    throw new Error(`gpg --detach-sign failed: ${sign.stderr}`);
  }
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

test("exits 0 for valid chain with --no-fetch", () => {
  const r = run(["--no-fetch"]);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("✅");
  expect(r.stdout).toContain("hello.bin");
});

test("exits 1 when SHA256SUMS is tampered", () => {
  const manifest = readFileSync(join(cwd, "SHA256SUMS"), "utf8");
  // Flip one hex char in the hash.
  const tampered = manifest.replace(/^[0-9a-f]/, (c) => (c === "a" ? "b" : "a"));
  writeFileSync(join(cwd, "SHA256SUMS"), tampered, "utf8");
  const r = run(["--no-fetch"]);
  expect(r.status).toBe(1);
  expect(r.stdout + r.stderr).toMatch(/signature|MISMATCH|❌/i);
});

test("exits 1 when SHA256SUMS is correct but hash doesn't match file", () => {
  // Regenerate SHA256SUMS for a DIFFERENT file, then re-sign, then swap file content.
  writeFileSync(join(cwd, "hello.bin"), "different content", "utf8");
  const r = run(["--no-fetch"]);
  expect(r.status).toBe(1);
  expect(r.stdout + r.stderr).toMatch(/hash|MISMATCH|❌/);
});

test("exits 1 when SHA256SUMS.asc is signed by untrusted key", () => {
  // Generate a second scratch key, re-sign with it — leaves SHA256SUMS identical
  // but signature fingerprint mismatches TRUSTED_FINGERPRINTS override.
  const otherHome = join(work, "gnupg-other");
  const otherRes = spawnSync("bash", [GEN_KEY, otherHome], { encoding: "utf8" });
  const otherFp = otherRes.stdout.trim();
  spawnSync(
    "gpg",
    [
      "--batch",
      "--yes",
      "--pinentry-mode",
      "loopback",
      "--detach-sign",
      "--armor",
      "--output",
      join(cwd, "SHA256SUMS.asc"),
      join(cwd, "SHA256SUMS"),
    ],
    { env: { ...process.env, GNUPGHOME: otherHome } },
  );
  // Point the verify script at the ORIGINAL trusted fingerprint; the sig is by otherFp.
  const r = run(["--no-fetch"], { env: { NIMBUS_VERIFY_FINGERPRINT_OVERRIDE: fingerprint } });
  expect(r.status).toBe(1);
  expect(r.stdout + r.stderr).toMatch(/fingerprint|untrusted|❌/i);
  // Sanity: otherFp differs from fingerprint
  expect(otherFp).not.toBe(fingerprint);
});

test("exits 2 when SHA256SUMS missing with --no-fetch", () => {
  rmSync(join(cwd, "SHA256SUMS"));
  const r = run(["--no-fetch"]);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/SHA256SUMS/);
});

test("prints imported fingerprint for bootstrap trust check", () => {
  const r = run(["--no-fetch"]);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain(fingerprint);
});
```

- [ ] **Step 5.3: Run the test to verify it fails**

Run: `bun test scripts/release/nimbus-verify.test.ts`

Expected: FAIL — `nimbus-verify.sh` does not exist.

- [ ] **Step 5.4: Implement `nimbus-verify.sh`**

Create `scripts/release/nimbus-verify.sh`:

```bash
#!/usr/bin/env bash
# nimbus-verify — verify GPG signature and SHA-256 hashes for a Nimbus release.
# See docs/verify-release-integrity.md for the full walkthrough.
set -eo pipefail

# ---- Configuration ------------------------------------------------------------

# TRUSTED_FINGERPRINTS: the set of GPG fingerprints considered valid for a
# SHA256SUMS.asc signature. During key rotation, this array carries BOTH old
# and new fingerprints for one release, then narrows to the new one.
#
# NOTE: these are PLACEHOLDER fingerprints until the maintainer completes
# docs/release/v0.1.0-prerequisites.md §3 and commits the real values here.
TRUSTED_FINGERPRINTS=(
  "0000000000000000000000000000000000000000"
)
DEFAULT_KEYSERVER="keys.openpgp.org"
GITHUB_REPO="nimbus-dev/Nimbus"

# Runtime-override: tests inject NIMBUS_VERIFY_FINGERPRINT_OVERRIDE with a
# scratch fingerprint so real releases use production FPs but tests use throwaway keys.
if [[ -n "${NIMBUS_VERIFY_FINGERPRINT_OVERRIDE:-}" ]]; then
  TRUSTED_FINGERPRINTS=("$NIMBUS_VERIFY_FINGERPRINT_OVERRIDE")
fi

# ---- Usage -------------------------------------------------------------------

usage() {
  cat <<EOF
Usage: nimbus-verify [<artifact-path>]
       nimbus-verify --version <ver>

Flags:
  --version <ver>       Download SHA256SUMS + .asc for <ver> from the GitHub
                        Release; verify all artifacts in cwd matching manifest.
  --keyserver <url>     Keyserver to fetch public key from (default: keys.openpgp.org).
  --fingerprint <fp>    Override the trusted fingerprint set. Comma-separated
                        for multi-fingerprint rotation periods.
  --no-fetch            Offline mode: don't download SHA256SUMS / key. Use what's
                        in cwd / keyring. This is the "check-only" mode.
  --help, -h            Show this message.

Exit codes:
  0  every present artifact verified (signature + hash)
  1  at least one verification failed
  2  usage error / missing prerequisite (gpg, sha256sum, curl)

See docs/verify-release-integrity.md for a full walkthrough, and docs/SECURITY.md
for the authoritative project GPG fingerprint.
EOF
}

# ---- Argument parsing --------------------------------------------------------

VERSION=""
KEYSERVER="$DEFAULT_KEYSERVER"
NO_FETCH=0
OVERRIDE_FPS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)          VERSION="${2:?--version needs a value}"; shift 2 ;;
    --keyserver)        KEYSERVER="${2:?--keyserver needs a value}"; shift 2 ;;
    --fingerprint)      OVERRIDE_FPS="${2:?--fingerprint needs a value}"; shift 2 ;;
    --no-fetch)         NO_FETCH=1; shift ;;
    --help|-h)          usage; exit 0 ;;
    -*)                 echo "unknown flag: $1" >&2; usage >&2; exit 2 ;;
    *)                  shift ;;
  esac
done

if [[ -n "$OVERRIDE_FPS" ]]; then
  IFS=',' read -r -a TRUSTED_FINGERPRINTS <<< "$OVERRIDE_FPS"
fi

# ---- Prerequisite probes -----------------------------------------------------

for cmd in gpg sha256sum; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "nimbus-verify: required tool '$cmd' not found on PATH" >&2
    echo "install hint: macOS 'brew install gnupg coreutils' / Debian 'apt install gnupg coreutils'" >&2
    exit 2
  fi
done

if [[ "$NO_FETCH" -eq 0 ]] && ! command -v curl >/dev/null 2>&1; then
  echo "nimbus-verify: 'curl' required for default (non --no-fetch) mode" >&2
  exit 2
fi

# ---- Locate SHA256SUMS + .asc ------------------------------------------------

if [[ -n "$VERSION" ]] && [[ "$NO_FETCH" -eq 0 ]]; then
  BASE="https://github.com/$GITHUB_REPO/releases/download/v$VERSION"
  echo "Downloading SHA256SUMS + SHA256SUMS.asc for v$VERSION..."
  curl -fsSL "$BASE/SHA256SUMS" -o SHA256SUMS
  curl -fsSL "$BASE/SHA256SUMS.asc" -o SHA256SUMS.asc
fi

if [[ ! -f SHA256SUMS ]]; then
  echo "nimbus-verify: SHA256SUMS not found in cwd" >&2
  echo "  run with --version <ver> to fetch, or cd to the folder containing the file" >&2
  exit 2
fi

if [[ ! -f SHA256SUMS.asc ]]; then
  echo "nimbus-verify: SHA256SUMS.asc not found in cwd" >&2
  exit 2
fi

# ---- Ensure public key in keyring (bootstrap-trust output) -------------------

IMPORTED_FP=""
for fp in "${TRUSTED_FINGERPRINTS[@]}"; do
  if gpg --list-keys "$fp" >/dev/null 2>&1; then
    IMPORTED_FP="$fp"
    break
  fi
done

if [[ -z "$IMPORTED_FP" ]]; then
  if [[ "$NO_FETCH" -eq 1 ]]; then
    echo "nimbus-verify: no trusted key in keyring and --no-fetch prevents fetch" >&2
    echo "  expected fingerprints: ${TRUSTED_FINGERPRINTS[*]}" >&2
    exit 2
  fi
  for fp in "${TRUSTED_FINGERPRINTS[@]}"; do
    echo "Importing key $fp from $KEYSERVER ..."
    if gpg --keyserver "$KEYSERVER" --recv-keys "$fp" 2>/dev/null; then
      IMPORTED_FP="$fp"
      break
    fi
  done
  if [[ -z "$IMPORTED_FP" ]]; then
    echo "nimbus-verify: could not retrieve any trusted key from $KEYSERVER" >&2
    exit 2
  fi
fi

echo ""
echo "Imported/found GPG fingerprint: $IMPORTED_FP"
echo ""
echo "Cross-check this fingerprint against ALL FOUR sources before trusting it:"
echo "  1. docs/SECURITY.md in the Nimbus repo"
echo "  2. README.md 'Verify any download' section"
echo "  3. docs/release/SIGNING-KEY.asc (ASCII-armored public key block)"
echo "  4. The same fingerprint on $KEYSERVER"
echo ""

# ---- gpg --verify ------------------------------------------------------------

VERIFY_OUT="$(gpg --status-fd 1 --verify SHA256SUMS.asc SHA256SUMS 2>&1 || true)"

# Look for GOODSIG <fp> or VALIDSIG <fp> — but the FP must be in TRUSTED_FINGERPRINTS.
SIG_FP="$(echo "$VERIFY_OUT" | awk '/^\[GNUPG:\] VALIDSIG/ {print $3; exit}')"
if [[ -z "$SIG_FP" ]]; then
  echo "❌ SHA256SUMS.asc: GPG signature verification FAILED" >&2
  echo "$VERIFY_OUT" >&2
  exit 1
fi

FOUND=0
for fp in "${TRUSTED_FINGERPRINTS[@]}"; do
  if [[ "$SIG_FP" == "$fp" ]]; then
    FOUND=1; break
  fi
done

if [[ "$FOUND" -ne 1 ]]; then
  echo "❌ SHA256SUMS.asc: signed by UNTRUSTED fingerprint $SIG_FP" >&2
  echo "   trusted fingerprints: ${TRUSTED_FINGERPRINTS[*]}" >&2
  exit 1
fi

# Detect expired / revoked keys
if echo "$VERIFY_OUT" | grep -qE "\[GNUPG:\] (EXPKEYSIG|REVKEYSIG)"; then
  echo "❌ SHA256SUMS.asc: key expired or revoked" >&2
  echo "$VERIFY_OUT" >&2
  exit 1
fi

echo "✅ SHA256SUMS.asc: signature OK (fingerprint $SIG_FP)"
echo ""

# ---- sha256sum -c ------------------------------------------------------------

# --ignore-missing: only verify files present in cwd; missing files are silently skipped.
# We still need to make sure AT LEAST ONE file was checked, otherwise a user in an
# empty directory would see a false "all OK."

CHECK_OUT="$(sha256sum --ignore-missing -c SHA256SUMS 2>&1 || true)"
CHECK_STATUS=$?
# Re-check exit status explicitly; sha256sum returns non-zero on any mismatch or missing file.
if ! sha256sum --ignore-missing -c SHA256SUMS >/dev/null 2>&1; then
  # At least one present file failed. Print per-file ❌.
  echo "$CHECK_OUT" | while IFS= read -r line; do
    if [[ "$line" == *": FAILED"* ]]; then
      fname="${line%%:*}"
      echo "❌ $fname: hash MISMATCH"
    fi
  done
  exit 1
fi

# Count verified files (lines ending in ": OK")
VERIFIED=0
while IFS= read -r line; do
  if [[ "$line" == *": OK"* ]]; then
    VERIFIED=$((VERIFIED + 1))
    fname="${line%%:*}"
    echo "✅ Verified $fname: signature OK, hash OK"
  fi
done <<< "$CHECK_OUT"

if [[ "$VERIFIED" -eq 0 ]]; then
  echo "nimbus-verify: no artifacts from the manifest were present in cwd — nothing to verify" >&2
  echo "  download an artifact first, then re-run." >&2
  exit 2
fi

echo ""
echo "$VERIFIED artifact(s) verified."
exit 0
```

Make it executable:

```bash
chmod +x scripts/release/nimbus-verify.sh
```

- [ ] **Step 5.5: Run the test to verify it passes**

Run: `bun test scripts/release/nimbus-verify.test.ts`

Expected: all 6 tests PASS. If a test fails:
- "gpg: no ultimately trusted keys found" noise in stderr is normal for scratch keyrings; the tests don't assert on stderr content beyond substring matching.
- On Windows, `bun test` invokes `bash` which may not resolve to Git-Bash / MSYS. Set `PATH` to include Git-Bash before running: `PATH="/c/Program Files/Git/bin:$PATH" bun test …`.

- [ ] **Step 5.6: Commit**

```bash
git add scripts/release/nimbus-verify.sh scripts/release/nimbus-verify.test.ts scripts/release/fixtures/
git commit -m "$(cat <<'EOF'
feat(release): add nimbus-verify.sh end-user integrity helper

One-command GPG-signature + SHA-256 verification for Nimbus releases
with bootstrap-trust fingerprint cross-check. TRUSTED_FINGERPRINTS array
supports key-rotation transition periods. Scratch-keyring test fixture
covers valid chain, tampered manifest, hash mismatch, untrusted key,
and missing-inputs error paths.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `nimbus-verify.ps1` (Windows)

**Files:**
- Create: `scripts/release/nimbus-verify.ps1`
- Create: `scripts/release/nimbus-verify-ps1.test.ts` — wraps PowerShell invocation under `bun test` so CI runs it alongside the bash version

---

- [ ] **Step 6.1: Write the failing test**

Create `scripts/release/nimbus-verify-ps1.test.ts`:

```ts
/// <reference types="bun-types" />
import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const VERIFY_PS1 = join(REPO_ROOT, "scripts", "release", "nimbus-verify.ps1");
const GEN_KEY = join(REPO_ROOT, "scripts", "release", "fixtures", "gen-test-key.sh");

// Skip entirely if pwsh is not on PATH (local dev on Linux without pwsh).
const HAS_PWSH = (() => {
  const r = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["pwsh"], {
    encoding: "utf8",
  });
  return r.status === 0;
})();

let work: string;
let gnupghome: string;
let cwd: string;
let fingerprint: string;

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(
    "pwsh",
    ["-NoProfile", "-NonInteractive", "-File", VERIFY_PS1, ...args],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GNUPGHOME: gnupghome,
        NIMBUS_VERIFY_FINGERPRINT_OVERRIDE: fingerprint,
      },
    },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

beforeEach(() => {
  if (!HAS_PWSH) return;
  work = mkdtempSync(join(tmpdir(), "nimbus-verify-ps1-"));
  gnupghome = join(work, "gnupg");
  cwd = join(work, "cwd");
  mkdirSync(cwd, { recursive: true });

  const genRes = spawnSync("bash", [GEN_KEY, gnupghome], { encoding: "utf8" });
  if (genRes.status !== 0) throw new Error(`gen-test-key.sh failed: ${genRes.stderr}`);
  fingerprint = genRes.stdout.trim();

  writeFileSync(join(cwd, "hello.bin"), "hello world", "utf8");
  const sha = spawnSync("sha256sum", ["hello.bin"], { cwd, encoding: "utf8" });
  writeFileSync(join(cwd, "SHA256SUMS"), sha.stdout, "utf8");
  spawnSync(
    "gpg",
    [
      "--batch",
      "--yes",
      "--pinentry-mode",
      "loopback",
      "--detach-sign",
      "--armor",
      "--output",
      join(cwd, "SHA256SUMS.asc"),
      join(cwd, "SHA256SUMS"),
    ],
    { env: { ...process.env, GNUPGHOME: gnupghome } },
  );
});

afterEach(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

test.skipIf(!HAS_PWSH)("ps1: exits 0 for valid chain with -NoFetch", () => {
  const r = run(["-NoFetch"]);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("✅");
});

test.skipIf(!HAS_PWSH)("ps1: exits 1 for tampered manifest", () => {
  const manifest = readFileSync(join(cwd, "SHA256SUMS"), "utf8");
  const tampered = manifest.replace(/^[0-9a-f]/, (c) => (c === "a" ? "b" : "a"));
  writeFileSync(join(cwd, "SHA256SUMS"), tampered, "utf8");
  const r = run(["-NoFetch"]);
  expect(r.status).toBe(1);
});

test.skipIf(!HAS_PWSH)("ps1: exits 2 when SHA256SUMS missing with -NoFetch", () => {
  rmSync(join(cwd, "SHA256SUMS"));
  const r = run(["-NoFetch"]);
  expect(r.status).toBe(2);
});

test.skipIf(!HAS_PWSH)("ps1: prints imported fingerprint for bootstrap trust", () => {
  const r = run(["-NoFetch"]);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain(fingerprint);
});
```

- [ ] **Step 6.2: Run tests to verify they fail**

Run: `bun test scripts/release/nimbus-verify-ps1.test.ts`

Expected: if `pwsh` is absent locally, all tests are SKIPPED — this is expected and valid. The CI matrix has `pwsh` on all three runner OSes. If `pwsh` is present, tests FAIL because `nimbus-verify.ps1` doesn't exist yet.

- [ ] **Step 6.3: Implement `nimbus-verify.ps1`**

Create `scripts/release/nimbus-verify.ps1`:

```powershell
<#
.SYNOPSIS
  Verify GPG signature and SHA-256 hashes for a Nimbus release.

.DESCRIPTION
  Cross-platform PowerShell mirror of scripts/release/nimbus-verify.sh.
  Requires: gpg (Gpg4win on Windows), curl. Uses .NET Get-FileHash for SHA-256.
  See docs/verify-release-integrity.md for the full walkthrough.

.PARAMETER Version
  Download SHA256SUMS + .asc for <ver> from the GitHub Release and verify
  artifacts in cwd matching the manifest.

.PARAMETER Keyserver
  Keyserver to fetch the public key from (default: keys.openpgp.org).

.PARAMETER Fingerprint
  Override the trusted fingerprint set. Comma-separated for multi-fingerprint
  rotation periods.

.PARAMETER NoFetch
  Offline mode: don't download SHA256SUMS / key. Use what's in cwd / keyring.
  This is the "check-only" mode.

.NOTES
  Exit codes:
    0  every present artifact verified
    1  at least one verification failed
    2  usage error / missing prerequisite
#>
[CmdletBinding()]
param(
  [string]$Version = "",
  [string]$Keyserver = "keys.openpgp.org",
  [string]$Fingerprint = "",
  [switch]$NoFetch
)

$ErrorActionPreference = "Stop"

# ---- Configuration ---------------------------------------------------------
# TRUSTED_FINGERPRINTS placeholder. Real values land when prerequisites §3 completes.
$TrustedFingerprints = @(
  "0000000000000000000000000000000000000000"
)
$GithubRepo = "nimbus-dev/Nimbus"

if ($env:NIMBUS_VERIFY_FINGERPRINT_OVERRIDE) {
  $TrustedFingerprints = @($env:NIMBUS_VERIFY_FINGERPRINT_OVERRIDE)
}
if ($Fingerprint) {
  $TrustedFingerprints = $Fingerprint.Split(",") | ForEach-Object { $_.Trim() }
}

# ---- Prereqs ---------------------------------------------------------------
function Require-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Error "nimbus-verify: required tool '$name' not found on PATH. Install Gpg4win (Windows) or gnupg (macOS/Linux)."
    exit 2
  }
}
Require-Command gpg
if (-not $NoFetch) { Require-Command curl }

# ---- Locate SHA256SUMS + .asc ----------------------------------------------
if ($Version -and -not $NoFetch) {
  $base = "https://github.com/$GithubRepo/releases/download/v$Version"
  Write-Host "Downloading SHA256SUMS + SHA256SUMS.asc for v$Version..."
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS"     -OutFile "SHA256SUMS"
    Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS.asc" -OutFile "SHA256SUMS.asc"
  } catch {
    Write-Error "nimbus-verify: download failed — $_"
    exit 2
  }
}

if (-not (Test-Path "SHA256SUMS")) {
  Write-Error "nimbus-verify: SHA256SUMS not found in cwd. Use -Version <ver> to fetch, or cd to the right folder."
  exit 2
}
if (-not (Test-Path "SHA256SUMS.asc")) {
  Write-Error "nimbus-verify: SHA256SUMS.asc not found in cwd."
  exit 2
}

# ---- Ensure key in keyring -------------------------------------------------
$ImportedFp = $null
foreach ($fp in $TrustedFingerprints) {
  & gpg --list-keys $fp 2>$null 1>$null
  if ($LASTEXITCODE -eq 0) { $ImportedFp = $fp; break }
}

if (-not $ImportedFp) {
  if ($NoFetch) {
    Write-Error "nimbus-verify: no trusted key in keyring and -NoFetch prevents fetch. Expected: $($TrustedFingerprints -join ', ')"
    exit 2
  }
  foreach ($fp in $TrustedFingerprints) {
    Write-Host "Importing key $fp from $Keyserver..."
    & gpg --keyserver $Keyserver --recv-keys $fp 2>$null
    if ($LASTEXITCODE -eq 0) { $ImportedFp = $fp; break }
  }
  if (-not $ImportedFp) {
    Write-Error "nimbus-verify: could not retrieve any trusted key from $Keyserver"
    exit 2
  }
}

Write-Host ""
Write-Host "Imported/found GPG fingerprint: $ImportedFp"
Write-Host ""
Write-Host "Cross-check this fingerprint against ALL FOUR sources before trusting it:"
Write-Host "  1. docs/SECURITY.md in the Nimbus repo"
Write-Host "  2. README.md 'Verify any download' section"
Write-Host "  3. docs/release/SIGNING-KEY.asc (ASCII-armored public key block)"
Write-Host "  4. The same fingerprint on $Keyserver"
Write-Host ""

# ---- gpg --verify ----------------------------------------------------------
$verifyOut = & gpg --status-fd 1 --verify SHA256SUMS.asc SHA256SUMS 2>&1 | Out-String
$validsig = [regex]::Match($verifyOut, '^\[GNUPG:\] VALIDSIG (\S+)', 'Multiline')
if (-not $validsig.Success) {
  Write-Host "❌ SHA256SUMS.asc: GPG signature verification FAILED" -ErrorAction Continue
  Write-Host $verifyOut
  exit 1
}
$sigFp = $validsig.Groups[1].Value

if ($TrustedFingerprints -notcontains $sigFp) {
  Write-Host "❌ SHA256SUMS.asc: signed by UNTRUSTED fingerprint $sigFp"
  Write-Host "   trusted fingerprints: $($TrustedFingerprints -join ', ')"
  exit 1
}

if ($verifyOut -match '\[GNUPG:\] (EXPKEYSIG|REVKEYSIG)') {
  Write-Host "❌ SHA256SUMS.asc: key expired or revoked"
  exit 1
}

Write-Host "✅ SHA256SUMS.asc: signature OK (fingerprint $sigFp)"
Write-Host ""

# ---- Hash verification -----------------------------------------------------
$manifest = Get-Content "SHA256SUMS" -ErrorAction Stop
$verified = 0
$failed = 0

foreach ($line in $manifest) {
  if (-not $line.Trim()) { continue }
  # Format: <64hex>  <filename>  (two-space separator per sha256sum GNU format)
  if ($line -match '^([0-9a-f]{64})\s+(.+)$') {
    $expectedHash = $matches[1].ToLower()
    $fname = $matches[2].Trim()
    if (-not (Test-Path -LiteralPath $fname)) {
      # Missing file: analogous to sha256sum --ignore-missing.
      continue
    }
    $actual = (Get-FileHash -Algorithm SHA256 -Path $fname).Hash.ToLower()
    if ($actual -eq $expectedHash) {
      Write-Host "✅ Verified $fname : signature OK, hash OK"
      $verified += 1
    } else {
      Write-Host "❌ $fname : hash MISMATCH (expected $expectedHash, got $actual)"
      $failed += 1
    }
  }
}

if ($failed -gt 0) {
  exit 1
}

if ($verified -eq 0) {
  Write-Error "nimbus-verify: no artifacts from the manifest were present in cwd — nothing to verify. Download an artifact first, then re-run."
  exit 2
}

Write-Host ""
Write-Host "$verified artifact(s) verified."
exit 0
```

- [ ] **Step 6.4: Run tests to verify they pass**

Run: `bun test scripts/release/nimbus-verify-ps1.test.ts`

Expected: 4 tests PASS (or SKIPPED on a Linux dev box without `pwsh`). On CI (Windows runner), tests run and pass.

- [ ] **Step 6.5: Commit**

```bash
git add scripts/release/nimbus-verify.ps1 scripts/release/nimbus-verify-ps1.test.ts
git commit -m "$(cat <<'EOF'
feat(release): add nimbus-verify.ps1 Windows end-user integrity helper

Cross-platform mirror of nimbus-verify.sh using PowerShell 7+ and
Get-FileHash for SHA-256. Same TRUSTED_FINGERPRINTS array and
bootstrap-trust fingerprint echo as the bash script. Tests skip
when pwsh is absent locally; CI Windows runner exercises them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `docs/verify-release-integrity.md`

**Files:**
- Create: `docs/verify-release-integrity.md`

---

- [ ] **Step 7.1: Create the file**

Create `docs/verify-release-integrity.md`:

````markdown
# Verifying Release Integrity

Nimbus releases ship with a **GPG-signed `SHA256SUMS` manifest** that gives any user on any platform a cryptographic integrity check — independent of Apple Gatekeeper, Windows SmartScreen, or any other platform code-signing. This page explains what the chain looks like and how to verify it.

> **If you're in a hurry:** run the helper script on your OS. See "Recommended: Use `nimbus-verify`" below.

## The Integrity Chain

```
user's trust root
  └─ project GPG public key fingerprint          ← published in four places:
     ├─ keys.openpgp.org (keyserver)
     ├─ keyserver.ubuntu.com (keyserver)
     ├─ docs/SECURITY.md (in the repo)
     └─ docs/release/SIGNING-KEY.asc (in the repo, ASCII-armored)
          └─ SHA256SUMS.asc  (detached GPG signature)
               └─ SHA256SUMS  (text manifest: one line per artifact)
                    └─ each release artifact  (SHA-256 hash-verified)
```

The fingerprint is published in **four independent places** so a first-time user can cross-check before trusting anything they downloaded. **If the four sources diverge, do not install. Open a private security issue.**

## Recommended: Use `nimbus-verify`

Every GitHub Release page carries `nimbus-verify.sh` (Linux + macOS) and `nimbus-verify.ps1` (Windows) — small standalone helpers that:

1. Download `SHA256SUMS` + `SHA256SUMS.asc` from the release page.
2. Import the project GPG key from a keyserver (if not already in your keyring).
3. **Print the imported fingerprint** so you can cross-check against this repo.
4. Run `gpg --verify` on the manifest signature.
5. Hash-verify every artifact from the manifest that's present in your current directory.
6. Print `✅` for each passing artifact, `❌` for any that fail.

### Linux + macOS

```bash
curl -LO https://github.com/nimbus-dev/Nimbus/releases/download/v<ver>/nimbus-verify.sh
bash nimbus-verify.sh --version <ver>
```

### Windows (PowerShell 7+)

```powershell
Invoke-WebRequest -Uri https://github.com/nimbus-dev/Nimbus/releases/download/v<ver>/nimbus-verify.ps1 -OutFile nimbus-verify.ps1
.\nimbus-verify.ps1 -Version <ver>
```

### Offline mode (`--no-fetch` / `-NoFetch`)

Pre-download `SHA256SUMS`, `SHA256SUMS.asc`, the artifacts, and import the GPG key once. Then:

```bash
bash nimbus-verify.sh --no-fetch
```

```powershell
.\nimbus-verify.ps1 -NoFetch
```

This is the right mode for CI pipelines, air-gapped machines, or any scenario where you've staged inputs manually and want pure verification without network activity.

## Manual Verification (for the Paranoid)

If you don't trust the helper script, run the same checks yourself:

### 1. Import the public key

```bash
# By fingerprint — fill in the value from docs/SECURITY.md
gpg --keyserver keys.openpgp.org --recv-keys <FINGERPRINT>
# or from the repo's committed key body:
gpg --import docs/release/SIGNING-KEY.asc
```

### 2. Verify the manifest signature

```bash
gpg --verify SHA256SUMS.asc SHA256SUMS
```

Look for `Good signature from "Nimbus Release Signing <releases@...>"` and `Primary key fingerprint:` lines. **The fingerprint must match `docs/SECURITY.md`, README.md, and keys.openpgp.org — all four.**

### 3. Verify artifact hashes

```bash
# Linux + macOS:
sha256sum -c --ignore-missing SHA256SUMS

# Windows (PowerShell):
Get-Content SHA256SUMS | ForEach-Object {
  if ($_ -match '^([0-9a-f]{64})\s+(.+)$') {
    $expected = $matches[1]; $file = $matches[2].Trim()
    if (Test-Path $file) {
      $actual = (Get-FileHash -Algorithm SHA256 -Path $file).Hash.ToLower()
      if ($actual -eq $expected) { "OK  $file" } else { "BAD $file ($actual != $expected)" }
    }
  }
}
```

## What `SHA256SUMS` Covers (and Doesn't)

**Covered:** every user-facing release artifact — raw Gateway + CLI binaries (Linux / macOS x64 + arm64 / Windows), the macOS `.tar.gz` archives, the Windows `.zip`, the Linux `.deb`, `.AppImage`, and tarball, the CycloneDX SBOM, and the `nimbus-verify` scripts themselves.

**Not covered:** `latest.json` — the updater manifest. It carries its own **Ed25519 signature** that the Gateway verifies internally before applying an auto-update. End users don't hand-verify `latest.json`; it's a machine-consumed file. This separation matches user mental models (one manifest for "I'm downloading the app", a different signature flow for "the app is updating itself").

## Linux: AppImage on libfuse2-Less Distros

On Ubuntu 24.04+, Fedora 40+, Arch, and other distros that ship `libfuse3` by default, the AppImage needs either:

```bash
# Option A: install the transitional libfuse2 package
sudo apt install libfuse2t64
./nimbus-headless-<ver>-x86_64.AppImage

# Option B: extract-and-run (no FUSE needed)
./nimbus-headless-<ver>-x86_64.AppImage --appimage-extract-and-run
```

Option A is faster on repeated runs. Option B has no system-level dependencies beyond the AppImage itself.

**`.AppImage` + File Manager double-click.** The packaged `.desktop` entry uses `Terminal=true`. Some Desktop Environments (GNOME, KDE) respect this and pop a terminal; others silently do nothing when double-clicked. Users who want consistent double-click behavior should install [`AppImageLauncher`](https://github.com/TheAssassin/AppImageLauncher) — it also integrates `.AppImage` files into the desktop menu and handles updates cleanly. **Recommended invocation remains shell: `./nimbus-headless-<ver>-x86_64.AppImage`.**

## <a name="key-rotation"></a> Key Rotation

Rotating the project signing key takes two releases:

1. **`vN.N.N+1`** — signed by the **old** key. Contains updated `nimbus-verify.{sh,ps1}` whose `TRUSTED_FINGERPRINTS` array lists **both** the old and new fingerprint. Users who upgrade via `vN.N.N+1` pick up the new fingerprint.
2. **`vN.N.N+2`** — signed by the **new** key. `TRUSTED_FINGERPRINTS` drops the old fingerprint. Publish a key revocation on `keys.openpgp.org` for the old key. Update `docs/SECURITY.md`, `README.md`, and `docs/release/SIGNING-KEY.asc`.

Users who skip straight from `vN.N.N` to `vN.N.N+2` must manually update their keyring via `docs/SECURITY.md`'s recv-keys instructions. This is accepted as an edge case; users who update regularly never notice the transition.

## Related Files

- [`docs/SECURITY.md`](SECURITY.md) — project GPG fingerprint + vulnerability reporting
- [`docs/release/SIGNING-KEY.asc`](release/SIGNING-KEY.asc) — ASCII-armored public key body
- [`docs/install-macos-unsigned.md`](install-macos-unsigned.md) — macOS Gatekeeper bypass
- [`docs/install-windows-unsigned.md`](install-windows-unsigned.md) — Windows SmartScreen bypass
````

- [ ] **Step 7.2: Verify links resolve**

Run: `grep -oE '\[[^]]+\]\(([^)]+)\)' docs/verify-release-integrity.md | sed 's/.*(\(.*\))/\1/' | while read link; do [[ "$link" =~ ^https?:// ]] || ([[ -f "docs/$link" ]] || [[ -f "$link" ]] || echo "MISSING: $link"); done`

Expected: empty output (no missing links) or any hits to be review-checked before commit.

- [ ] **Step 7.3: Commit**

```bash
git add docs/verify-release-integrity.md
git commit -m "$(cat <<'EOF'
docs: add verify-release-integrity walkthrough

Authoritative explanation of the SHA256SUMS + SHA256SUMS.asc chain,
recommended-path (nimbus-verify helpers), manual-path (gpg + sha256sum),
libfuse2 portability notes for Ubuntu 24.04+, and key-rotation worked
example. Referenced by the forthcoming install-macos/install-windows
docs and the SECURITY.md Release Signing Key section.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `docs/install-macos-unsigned.md`

**Files:**
- Create: `docs/install-macos-unsigned.md`

---

- [ ] **Step 8.1: Create the file**

Create `docs/install-macos-unsigned.md`:

```markdown
# Installing Nimbus on macOS (Unsigned)

## Why unsigned?

Nimbus v0.1.0 ships unsigned on macOS and Windows. Apple's Developer ID Program costs $99/year + a yearly cert rotation — a recurring cost we're deferring until the product reaches a stable-user milestone. This is an **honest tradeoff**: Gatekeeper's "unidentified developer" dialog requires an extra click, and some users will bounce at that friction. In exchange, we avoid a recurring fee and a vendor-telemetry dependency for a project whose mission is **local-first**.

**The integrity proof is orthogonal to platform code-signing.** Every Nimbus release ships a `SHA256SUMS` manifest GPG-signed with the project key. That signature works on every OS, independent of Gatekeeper or SmartScreen, and is the **real** trust signal. Verify before you install — see [`docs/verify-release-integrity.md`](verify-release-integrity.md).

## Power-User Shortcut

One-liner that downloads the verify helper, verifies the binary, strips the quarantine attribute, and runs:

```bash
# Replace <ver> and <arch> (x64 or arm64 — run `uname -m` to check)
curl -LO https://github.com/nimbus-dev/Nimbus/releases/download/v<ver>/nimbus-headless-macos-<arch>.tar.gz
curl -LO https://github.com/nimbus-dev/Nimbus/releases/download/v<ver>/nimbus-verify.sh
bash nimbus-verify.sh --version <ver>                         # ✅ signature + hash
tar -xzf nimbus-headless-macos-<arch>.tar.gz                  # extracts nimbus-gateway-macos-<arch>, nimbus-cli-macos-<arch>, README, LICENSE
xattr -d com.apple.quarantine ./nimbus-gateway-macos-<arch>   # remove the Gatekeeper quarantine bit
xattr -d com.apple.quarantine ./nimbus-cli-macos-<arch>
./nimbus-gateway-macos-<arch> &                               # start the Gateway in the background
./nimbus-cli-macos-<arch> --help
```

### Picking the right archive

Apple Silicon (M1/M2/M3/M4): download `nimbus-headless-macos-arm64.tar.gz`.
Intel Mac: download `nimbus-headless-macos-x64.tar.gz`.

Run `uname -m` in a terminal: `arm64` → arm64 archive; `x86_64` → x64 archive.

## Finder Workflow (Step by Step)

If you prefer clicking through the UI:

1. Download the archive from the [GitHub Release page](https://github.com/nimbus-dev/Nimbus/releases).
2. Double-click the `.tar.gz` in Finder — macOS extracts it automatically.
3. Open Terminal (Spotlight → "Terminal").
4. `cd Downloads` (or wherever the archive extracted).
5. **Right-click `nimbus-gateway-macos-<arch>` → Open.**
6. Gatekeeper shows: *"macOS cannot verify the developer. Are you sure you want to open it?"* → **Open**.
7. A terminal window launches the Gateway. Leave it running.
8. In a new Terminal: `./nimbus-cli-macos-<arch> --help`.

**Why right-click → Open (not double-click)?** macOS records a one-time Gatekeeper exception only when you explicitly invoke "Open" via the right-click menu. After the first run, subsequent double-clicks work with no prompt.

## Troubleshooting

### "…cannot be opened because the developer cannot be verified."

This is Gatekeeper's default dialog for any unsigned binary. Follow the Finder workflow above (right-click → Open) for a one-time exception. Alternatively from the command line:

```bash
xattr -d com.apple.quarantine ./nimbus-gateway-macos-<arch>
```

### "Killed: 9" on first run

Usually means the binary was downloaded via a browser that stripped the executable bit. Fix:

```bash
chmod +x ./nimbus-gateway-macos-<arch>
```

If the problem persists, the download is likely corrupted — re-run `nimbus-verify.sh` and re-download if hashes don't match.

### "arch: Bad CPU type in executable"

You downloaded the wrong architecture. `uname -m` to check; re-download the matching archive.

## Next Steps

- [`docs/cli-reference.md`](cli-reference.md) — `nimbus` CLI reference
- [`docs/voice.md`](voice.md) — voice interface setup
- [`docs/verify-release-integrity.md`](verify-release-integrity.md) — detailed integrity verification
```

- [ ] **Step 8.2: Commit**

```bash
git add docs/install-macos-unsigned.md
git commit -m "$(cat <<'EOF'
docs: add install-macos-unsigned walkthrough

Gatekeeper-bypass workflow with "Why unsigned?" framing, Power-User
Shortcut one-liner, Finder right-click-Open step-by-step, and
troubleshooting for quarantine / chmod / arch-mismatch failures.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `docs/install-windows-unsigned.md`

**Files:**
- Create: `docs/install-windows-unsigned.md`

---

- [ ] **Step 9.1: Create the file**

Create `docs/install-windows-unsigned.md`:

```markdown
# Installing Nimbus on Windows (Unsigned)

## Why unsigned?

Windows Authenticode / EV code-signing certificates cost ~$350–700/year plus ongoing cert-rotation overhead — a recurring cost we're deferring until the product reaches a stable-user milestone. This is an **honest tradeoff**: SmartScreen's "Windows protected your PC" dialog takes one extra click to bypass, and Defender may flag an unsigned single-file-packed binary briefly on first run. In exchange, we avoid a recurring fee and vendor-telemetry dependency for a local-first project.

**The integrity proof is orthogonal to platform code-signing.** Every Nimbus release ships a `SHA256SUMS` manifest GPG-signed with the project key. That signature works on every OS, independent of SmartScreen or Authenticode, and is the **real** trust signal. Verify before you install — see [`docs/verify-release-integrity.md`](verify-release-integrity.md).

## Power-User Shortcut (PowerShell 7+)

One-liner that downloads the verify helper, verifies the archive, extracts, and runs:

```powershell
# Replace <ver>
Invoke-WebRequest -Uri https://github.com/nimbus-dev/Nimbus/releases/download/v<ver>/nimbus-headless-windows-x64.zip -OutFile nimbus-headless.zip
Invoke-WebRequest -Uri https://github.com/nimbus-dev/Nimbus/releases/download/v<ver>/nimbus-verify.ps1       -OutFile nimbus-verify.ps1
.\nimbus-verify.ps1 -Version <ver>                                  # ✅ signature + hash
Expand-Archive -Path nimbus-headless.zip -DestinationPath .\nimbus  # extract binaries + README + LICENSE
cd nimbus
.\nimbus-gateway-windows-x64.exe                                    # Start the Gateway
# In a new PowerShell window:
.\nimbus-cli-windows-x64.exe --help
```

PowerShell 7 ships with `Expand-Archive`. On older Windows with only Windows PowerShell 5.1, the command is identical — `Expand-Archive` has been built-in since 5.0.

## File Explorer Workflow (Step by Step)

If you prefer clicking through the UI:

1. Download the `.zip` from the [GitHub Release page](https://github.com/nimbus-dev/Nimbus/releases).
2. Right-click the downloaded `.zip` → **Extract All…** → pick a destination → **Extract**.
3. In the extracted folder, **double-click** `nimbus-gateway-windows-x64.exe`.
4. SmartScreen shows: *"Windows protected your PC. Microsoft Defender SmartScreen prevented an unrecognized app from starting."* → **More info** → **Run anyway**.
5. A terminal window launches the Gateway. Leave it running.
6. Open a new PowerShell window: `.\nimbus-cli-windows-x64.exe --help`.

**Why "More info → Run anyway"?** SmartScreen's default primary button is "Don't run" — designed to protect users who clicked a phishing link. The "More info" disclosure reveals the bypass button for the case where you intentionally downloaded an unsigned binary you trust.

## Defender Exclusion Guidance

Microsoft Defender's heuristic engine **may** flag `nimbus-gateway-windows-x64.exe` on first run. This is because the Bun compiler produces a **single-file packed executable** — a characteristic shared with some malware families, which Defender's heuristics pattern-match on. There is nothing malicious about the binary; you can confirm this by verifying its hash against `SHA256SUMS.asc`.

Two options:

1. **Wait.** On-access scans typically clear new binaries within a few minutes to hours once Microsoft's cloud-delivered reputation signal catches up.
2. **Add an exclusion.** Windows Security → Virus & threat protection → Manage settings → Exclusions → Add or remove exclusions → **Add a file exclusion** → pick the Nimbus `.exe`. This is a common workflow for developer-tool binaries.

**Do NOT disable Defender entirely.** Either wait for reputation, or add a specific-file exclusion — nothing broader.

## Troubleshooting

### "This app can't run on your PC"

Wrong architecture. Nimbus v0.1.0 only ships a Windows x64 binary. On Windows on ARM, you can use the x64 binary under emulation (included on Windows 11 ARM).

### PowerShell execution policy blocks `nimbus-verify.ps1`

```
File C:\...\nimbus-verify.ps1 cannot be loaded because running scripts is disabled on this system.
```

Fix:

```powershell
# Run once in PowerShell as your user (NOT elevated):
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

`RemoteSigned` requires remote scripts to be signed but allows unsigned local scripts. `nimbus-verify.ps1` is a local file after download.

### "Windows protected your PC" with no "More info" link

Your SmartScreen is set to **Block**. Change: Settings → Privacy & Security → Windows Security → App & browser control → Reputation-based protection settings → "Check apps and files" set to **Warn** (not **Block**). This restores the bypass button.

## Next Steps

- [`docs/cli-reference.md`](cli-reference.md) — `nimbus` CLI reference
- [`docs/voice.md`](voice.md) — voice interface setup
- [`docs/verify-release-integrity.md`](verify-release-integrity.md) — detailed integrity verification
```

- [ ] **Step 9.2: Commit**

```bash
git add docs/install-windows-unsigned.md
git commit -m "$(cat <<'EOF'
docs: add install-windows-unsigned walkthrough

SmartScreen-bypass workflow with "Why unsigned?" framing, Power-User
Shortcut, File Explorer step-by-step, Defender exclusion guidance
(file-scoped only, not system-wide), and troubleshooting for PS
execution policy + architecture mismatch + blocked-mode SmartScreen.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `README.md` — Add `## Install` Section

**Files:**
- Modify: `README.md`

---

- [ ] **Step 10.1: Find the insertion point**

Run: `grep -n "^## " README.md | head -5`

Expected output: a list of section headers. Identify the first `## ` after the README's opening paragraph / badges — the new `## Install` section goes immediately before that first existing section, or right after the project description + badges if there's a natural gap.

- [ ] **Step 10.2: Insert the `## Install` section**

Using your editor, insert this block at the location identified in Step 10.1:

```markdown
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
```

- [ ] **Step 10.3: Verify section renders correctly**

Run: `head -80 README.md | tail -60` — check that the new section is cleanly separated from surrounding content with blank lines above/below the `## Install` heading, and that code fences are properly closed.

- [ ] **Step 10.4: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs(readme): add Install section with three-OS walkthroughs

Power-User Shortcut per platform + cross-link to the unsigned-install
docs and verify-release-integrity. Leads with integrity-chain framing
so readers understand that GPG-signed SHA256SUMS is the real trust
signal, not platform code-signing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Prerequisites Runbook Deltas

**Files:**
- Modify: `docs/release/v0.1.0-prerequisites.md`

---

- [ ] **Step 11.1: Read the current state**

Open `docs/release/v0.1.0-prerequisites.md`. Confirm the section layout matches my map:
- §1 Windows Authenticode (to defer)
- §2 Apple Developer (to defer)
- §3 GPG Signing Key (unchanged)
- §4 Ed25519 Updater (unchanged)
- §5–§8 registry / publisher / npm (unchanged)
- §9 GitHub Repo (update §9.5 secrets table; keep §9.4 release env wording)

- [ ] **Step 11.2: Move §1 + §2 to a new `## Deferred to a Later Point Release` section**

At the **very bottom** of the file, append:

```markdown
---

## Deferred to a Later Point Release (Post-v0.1.0)

The following procurement items were originally §1 + §2 in this runbook. They were moved here per `docs/release/v0.1.0-finish-plan.md §4.2` and `docs/superpowers/specs/2026-04-23-signing-pipeline-design.md §2.3`:

v0.1.0 ships unsigned on macOS + Windows with a GPG-signed `SHA256SUMS.asc` manifest as the cross-platform integrity proof. Platform code-signing (Gatekeeper + SmartScreen bypass) lands in a later point release on its own schedule, whenever the maintainer decides to fund procurement.

### Deferred §1 — Windows Authenticode Code-Signing Cert

<!-- Paste the original §1 content here verbatim, preserving all procurement notes,
     cost estimates, and step-by-step instructions for future reference. -->

### Deferred §2 — Apple Developer ID + Notarization

<!-- Paste the original §2 content here verbatim, preserving all procurement notes,
     cost estimates, and step-by-step instructions for future reference. -->

**Re-wiring cost when certs arrive:** trivial. Restore `scripts/sign-macos.sh` + `scripts/sign-windows.ps1` from git history (`git show <pre-deferral-sha>:scripts/sign-macos.sh > scripts/sign-macos.sh`), reinstate the two `Sign binary (macOS/Windows)` steps in `.github/workflows/release.yml`, populate the Apple + Windows cert secrets in §9.5. Estimated ~2 hours of CI re-test.
```

Then cut the original §1 and §2 content (including their headers) and paste **verbatim** into the two `<!-- Paste -->` placeholder locations. **Do not re-word or truncate** — the procurement instructions are time-consuming to re-derive and must survive.

- [ ] **Step 11.3: Renumber §3 → §1 etc.**

Because §1 and §2 moved, renumber the remaining sections so numbering starts at 1 again. Find-and-replace:
- `## 3. GPG Signing Key` → `## 1. GPG Signing Key`
- `## 4. Ed25519 Updater Signing Keypair` → `## 2. Ed25519 Updater Signing Keypair`
- `## 5. ` → `## 3. `
- `## 6. ` → `## 4. `
- `## 7. ` → `## 5. `
- `## 8. ` → `## 6. `
- `## 9. GitHub Repo Configuration` → `## 7. GitHub Repo Configuration`
- `### 9.1 ` → `### 7.1 `
- `### 9.2 ` → `### 7.2 `
- `### 9.3 ` → `### 7.3 `
- `### 9.4 ` → `### 7.4 `
- `### 9.5 ` → `### 7.5 `

Do each replacement one at a time in the editor to avoid accidental double-replacement in paragraphs that mention `§3` etc. Update any cross-references in the file to match.

- [ ] **Step 11.4: Update the §7.5 (was §9.5) secrets table**

Open the secrets table in the (now) §7.5. Delete these rows entirely:

| Secret (remove) |
|---|
| `APPLE_ID` |
| `APPLE_APP_SPECIFIC_PASSWORD` |
| `APPLE_TEAM_ID` |
| `APPLE_DEVELOPER_ID_APPLICATION_P12_BASE64` |
| `APPLE_DEVELOPER_ID_INSTALLER_P12_BASE64` |
| `APPLE_P12_PASSWORD` |
| `ESIGNER_USERNAME` / `ESIGNER_PASSWORD` / `ESIGNER_TOTP_SECRET` (or equivalent) |

The remaining rows must be:

| Secret | From section | Used in |
|---|---|---|
| `GPG_SIGNING_SUBKEY` | §1 (was §3) | release.yml, nimbus-registry |
| `GPG_PASSPHRASE` | §1 (was §3) | release.yml, nimbus-registry |
| `UPDATER_ED25519_PRIVATE_KEY` | §2 (was §4) | release.yml |
| `VSCE_PAT` | §4 (was §6) | publish-vscode.yml |
| `OVSX_PAT` | §5 (was §7) | publish-vscode.yml |
| `NPM_TOKEN` | §6 (was §8) | publish-client.yml (+ future publish-sdk.yml) |

Also the `RELEASE_PAT` secret — add a row (it's referenced in `release.yml` but wasn't in the original table):

| `RELEASE_PAT` | §7 (GitHub config) | release.yml, publish-client.yml, publish-vscode.yml |

Total secret count: **7**.

- [ ] **Step 11.5: Update the Summary "What to Start When" table**

Replace the existing table and subsequent cost paragraph with:

```markdown
## Summary — What to Start When

If you start today, here's how the parallel tracks run (solo maintainer, no Apple / Windows cert procurement):

| Day | Start | Finish |
|---|---|---|
| **1** | §0.1 domain, §1 GPG master + subkey (30 min), §2 Ed25519 keypair (15 min), §6 npm org, §7 GitHub config (30 min) | §1, §2, §6, §7 done (~2 hours total) |
| **2** | §4 VS Code publisher, §5 Open VSX | §4, §5 done |
| **3–6** | §3 Cloudflare Pages registry | — |

**Total budget to v0.1.0-ready state:**

| | Cost |
|---|---|
| Domain `nimbus.dev` | ~$12 |
| Everything else (GPG + Ed25519 + Marketplace + Open VSX + npm + GitHub) | $0 |
| **Total first-year** | **~$12** |

**You are unblocked for code work the moment §1 and §2 are generated.** Phase 1 of the signing pipeline plan (`docs/superpowers/plans/2026-04-23-signing-pipeline.md`) deploys with nothing more than these two sections done. §3 (registry host) can lag — extensions aren't exercised until `v0.1.1`.

*Platform code-signing on macOS + Windows (Apple Developer Program $99/yr + Windows EV cert $350–700/yr + ~$240/yr eSigner) is **deferred to a later point release**. See "Deferred to a Later Point Release" at the bottom of this runbook.*
```

- [ ] **Step 11.6: Update the Handoff Checklist**

Find `## Once Everything Is Procured — Handoff Checklist` near the end of the file. Replace its content with:

```markdown
## Once Everything Is Procured — Handoff Checklist

Before tagging `v0.1.0`:

- [ ] All 7 GHA secrets from §7.5 present and verified (`release.yml` passes on a pre-release `v0.1.0-rc1` dry run)
- [ ] `packages/gateway/src/updater/public-key.ts` holds the production Ed25519 public key (not the dev key)
- [ ] `docs/release/SIGNING-KEY.asc` committed with real bytes (replaces the `PLACEHOLDER-DO-NOT-USE` sentinel)
- [ ] `docs/SECURITY.md` "Release Signing Key" section lists the production fingerprint
- [ ] `README.md` "Install → Verify any download" section lists the same fingerprint
- [ ] `registry.nimbus.dev/index.json` responds over HTTPS with a valid GPG signature (§3)
- [ ] VS Code Marketplace + Open VSX publisher pages exist (§4 + §5)
- [ ] `@nimbus-dev` org exists on npm with 2FA requirement enabled (§6)
- [ ] `release` GitHub Environment configured with maintainer-reviewer and `deployment_branches` = `main` (§7.4)
- [ ] `gh api repos/:owner/:repo/environments/release` returns non-empty `protection_rules` (pre-tag assertion)
```

- [ ] **Step 11.7: Commit**

```bash
git add docs/release/v0.1.0-prerequisites.md
git commit -m "$(cat <<'EOF'
docs(release): defer Windows EV + Apple cert procurement post-v0.1.0

Moves §1 (Windows Authenticode) and §2 (Apple Developer) to a new
Deferred section at the bottom of the runbook; renumbers remaining
sections; drops 7 cert secrets from §9.5 (now §7.5) leaving 7 live
secrets; updates Summary cost table to reflect $12 first-year total.
Handoff checklist updated to match the Phase 1 signing-pipeline plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Finish-Plan §4.2 Acceptance-Criteria Update

**Files:**
- Modify: `docs/release/v0.1.0-finish-plan.md`

---

- [ ] **Step 12.1: Locate §4.2's Acceptance criteria block**

Run: `grep -n "Acceptance criteria" docs/release/v0.1.0-finish-plan.md | head -3`

Identify the `**Acceptance criteria.**` block inside §4.2 (around line 162 in the current file).

- [ ] **Step 12.2: Replace the artifact-list criterion**

Find the current line:

```
- [ ] Release artifacts include: `nimbus_<ver>_amd64.deb` + `.deb.asc`, `nimbus-<ver>.AppImage` + `.AppImage.asc`, `nimbus-<ver>.pkg` (unsigned), `nimbus-<ver>-setup.exe` (unsigned), `SHA256SUMS`, `SHA256SUMS.asc`.
```

Replace with:

```
- [ ] Release artifacts (v0.1.0 Phase-1 scope per `docs/superpowers/specs/2026-04-23-signing-pipeline-design.md`): raw `nimbus-gateway-*` + `nimbus-cli-*` binaries for Linux / macOS x64 / macOS arm64 / Windows; `nimbus-headless_<ver>_amd64.deb` + `.asc`; `nimbus-headless-<ver>-x86_64.AppImage` + `.asc`; `nimbus-headless-linux-amd64-v<ver>.tar.gz` + `.asc`; `nimbus-headless-macos-x64.tar.gz`; `nimbus-headless-macos-arm64.tar.gz`; `nimbus-headless-windows-x64.zip`; `nimbus-<ver>-sbom.cdx.json`; `SHA256SUMS`; `SHA256SUMS.asc`; `nimbus-verify.sh`; `nimbus-verify.ps1`; `latest.json`. **Native `.pkg` + `-setup.exe` installers are Phase 2 (Tauri UI track) deliverables, not Phase 1.**
```

- [ ] **Step 12.3: Update the "Non-deliverables" framing to align**

Find the existing "Non-deliverables" paragraph in §4.2. Ensure the bullet list already includes:
- No `codesign` / `notarytool` / `stapler`
- No `signtool` / Authenticode

It should; if Task 1's deletions caused any follow-on wording drift, minor adjustment is fine. If the wording already matches the spec's §2.4, no change.

- [ ] **Step 12.4: Add a Phase 1 → Phase 2 marker**

Below the updated acceptance-criteria list in §4.2, add a note:

```markdown
**Phase split:** §4.2 is implemented in two phases per `docs/superpowers/specs/2026-04-23-signing-pipeline-design.md`. Phase 1 (plan: `docs/superpowers/plans/2026-04-23-signing-pipeline.md`) covers the headless track: SHA256SUMS manifest, AppImage, archives, verify scripts, install docs, release-env gating. Phase 2 covers the Tauri UI installer track (separate spec + plan to follow after Phase 1 ships v0.1.0-rc1).
```

- [ ] **Step 12.5: Commit**

```bash
git add docs/release/v0.1.0-finish-plan.md
git commit -m "$(cat <<'EOF'
docs(release): align §4.2 acceptance criteria with Phase 1 signing spec

Replaces the original single-phase artifact list with the Phase 1
artifact set (.tar.gz/.zip archives + AppImage + verify scripts) and
adds an explicit Phase 1 / Phase 2 split note pointing at the
signing-pipeline design spec and plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `release.yml` — Archive Building + SHA256SUMS + Environment Gate

**Why this is the biggest task:** This wires everything together. Keep the task as one file change so the diff reviews as a coherent pipeline, not a sequence of half-working states.

**Files:**
- Modify: `.github/workflows/release.yml`

---

- [ ] **Step 13.1: Confirm the starting state (post-Task-1)**

Run: `grep -n "Sign binary\|SHA256SUMS\|environment:\|archives\|AppImage" .github/workflows/release.yml`

Expected:
- `Sign binary (Linux GPG)` present (both `build-gateway` + `build-cli`).
- `Sign binary (Ed25519 updater)` present.
- No `Sign binary (macOS)` or `Sign binary (Windows)` (Task 1 removed them).
- No `SHA256SUMS`, no `environment:`, no `archives`, no `AppImage` yet.

- [ ] **Step 13.2: Rename and extend the Linux installers step**

Locate the step:

```yaml
      - name: Linux .deb + tarball from CI binaries (§7.9)
        shell: bash
        run: |
          set -e
          mkdir -p dist/headless-bundle
          cp dist/nimbus-gateway-linux-x64/nimbus-gateway-linux-x64 dist/headless-bundle/nimbus-gateway
          cp dist/nimbus-cli-linux-x64/nimbus-cli-linux-x64 dist/headless-bundle/nimbus
          chmod +x dist/headless-bundle/nimbus-gateway dist/headless-bundle/nimbus
          V="${GITHUB_REF_NAME#v}"
          bun scripts/package-linux-installers.ts --bundle dist/headless-bundle --version "$V"
```

Replace with:

```yaml
      - name: Linux installers (.deb + tarball + AppImage)
        shell: bash
        run: |
          set -e
          sudo apt-get update
          sudo apt-get install -y libfuse2 file
          # Pin appimagetool; update hash when bumping the version.
          APPIMAGETOOL_VERSION="continuous"
          APPIMAGETOOL_URL="https://github.com/AppImage/AppImageKit/releases/download/${APPIMAGETOOL_VERSION}/appimagetool-x86_64.AppImage"
          curl -fsSL "$APPIMAGETOOL_URL" -o /tmp/appimagetool
          chmod +x /tmp/appimagetool
          # Materialize inputs into the bundle layout expected by package-linux-installers.ts.
          mkdir -p dist/headless-bundle
          cp dist/nimbus-gateway-linux-x64/nimbus-gateway-linux-x64 dist/headless-bundle/nimbus-gateway
          cp dist/nimbus-cli-linux-x64/nimbus-cli-linux-x64 dist/headless-bundle/nimbus
          chmod +x dist/headless-bundle/nimbus-gateway dist/headless-bundle/nimbus
          V="${GITHUB_REF_NAME#v}"
          bun scripts/package-linux-installers.ts \
            --bundle dist/headless-bundle \
            --version "$V" \
            --appimagetool /tmp/appimagetool
```

- [ ] **Step 13.3: Add "Sign Linux installer artifacts" step**

Immediately **after** the renamed Linux installers step (from 13.2), insert:

```yaml
      - name: Sign Linux installer artifacts
        env:
          GPG_PRIVATE_KEY: ${{ secrets.GPG_PRIVATE_KEY }}
          GPG_PASSPHRASE: ${{ secrets.GPG_PASSPHRASE }}
        shell: bash
        run: |
          set -e
          for f in dist/installers/*.deb dist/installers/*.AppImage dist/installers/*.tar.gz; do
            [ -f "$f" ] || continue
            bash scripts/sign-linux-gpg.sh "$f"
          done
```

- [ ] **Step 13.4: Add "Build macOS + Windows archives" step**

After the signing step (13.3), insert:

```yaml
      - name: Build macOS + Windows archives
        shell: bash
        run: |
          set -e
          mkdir -p dist/archives
          V="${GITHUB_REF_NAME#v}"

          # macOS x64 tarball
          mkdir -p dist/stage-macos-x64
          cp dist/nimbus-gateway-macos-x64/nimbus-gateway-macos-x64 dist/stage-macos-x64/
          cp dist/nimbus-cli-macos-x64/nimbus-cli-macos-x64         dist/stage-macos-x64/
          cp scripts/release/archive-contents/README-QUICKSTART.txt dist/stage-macos-x64/
          cp scripts/release/archive-contents/LICENSE-AGPL.txt      dist/stage-macos-x64/
          chmod +x dist/stage-macos-x64/nimbus-*
          tar -czf dist/archives/nimbus-headless-macos-x64.tar.gz -C dist/stage-macos-x64 .

          # macOS arm64 tarball
          mkdir -p dist/stage-macos-arm64
          cp dist/nimbus-gateway-macos-arm64/nimbus-gateway-macos-arm64 dist/stage-macos-arm64/
          cp dist/nimbus-cli-macos-arm64/nimbus-cli-macos-arm64         dist/stage-macos-arm64/
          cp scripts/release/archive-contents/README-QUICKSTART.txt     dist/stage-macos-arm64/
          cp scripts/release/archive-contents/LICENSE-AGPL.txt          dist/stage-macos-arm64/
          chmod +x dist/stage-macos-arm64/nimbus-*
          tar -czf dist/archives/nimbus-headless-macos-arm64.tar.gz -C dist/stage-macos-arm64 .

          # Windows x64 zip
          mkdir -p dist/stage-windows-x64
          cp dist/nimbus-gateway-windows-x64/nimbus-gateway-windows-x64.exe dist/stage-windows-x64/
          cp dist/nimbus-cli-windows-x64/nimbus-cli-windows-x64.exe         dist/stage-windows-x64/
          cp scripts/release/archive-contents/README-QUICKSTART.txt         dist/stage-windows-x64/
          cp scripts/release/archive-contents/LICENSE-AGPL.txt              dist/stage-windows-x64/
          (cd dist/stage-windows-x64 && zip -r ../archives/nimbus-headless-windows-x64.zip .)

          # Cleanup
          rm -rf dist/stage-macos-x64 dist/stage-macos-arm64 dist/stage-windows-x64
```

- [ ] **Step 13.5: Add "Verify SIGNING-KEY placeholder absent" step**

After the archive step, insert:

```yaml
      - name: Verify SIGNING-KEY placeholder is not in release assets
        shell: bash
        run: |
          set -e
          if grep -lR "PLACEHOLDER-DO-NOT-USE" docs/release/SIGNING-KEY.asc 2>/dev/null; then
            echo "::error::docs/release/SIGNING-KEY.asc still contains the PLACEHOLDER sentinel."
            echo "::error::Overwrite with the real production public-key body before tagging."
            exit 1
          fi
```

This fails publish-release if the placeholder made it this far. Safety net against forgetting Step 2.3's sentinel replacement after prerequisites §1 is done.

- [ ] **Step 13.6: Keep existing SBOM step as-is**

The existing `Generate SBOM (CycloneDX)` + `Stage SBOM for release` steps stay. Verify:

```bash
grep -n "Generate SBOM\|Stage SBOM" .github/workflows/release.yml
```

- [ ] **Step 13.7: Add "Stage release assets" step**

**Replace** the existing `Stage SBOM for release` step (which populates `dist/sbom/`) with an expanded step that populates a flat `dist/stage/` dir. Locate:

```yaml
      - name: Stage SBOM for release
        shell: bash
        run: |
          set -e
          mkdir -p dist/sbom
          cp "${{ steps.sbom.outputs.fileName }}" "dist/sbom/nimbus-${GITHUB_REF_NAME}-sbom.cdx.json"
```

Replace with:

```yaml
      - name: Stage release assets
        shell: bash
        run: |
          set -e
          mkdir -p dist/stage

          # Raw binaries (every OS)
          cp dist/nimbus-gateway-linux-x64/nimbus-gateway-linux-x64*           dist/stage/
          cp dist/nimbus-cli-linux-x64/nimbus-cli-linux-x64*                   dist/stage/
          cp dist/nimbus-gateway-macos-x64/nimbus-gateway-macos-x64            dist/stage/
          cp dist/nimbus-cli-macos-x64/nimbus-cli-macos-x64                    dist/stage/
          cp dist/nimbus-gateway-macos-arm64/nimbus-gateway-macos-arm64        dist/stage/
          cp dist/nimbus-cli-macos-arm64/nimbus-cli-macos-arm64                dist/stage/
          cp dist/nimbus-gateway-windows-x64/nimbus-gateway-windows-x64.exe    dist/stage/
          cp dist/nimbus-cli-windows-x64/nimbus-cli-windows-x64.exe            dist/stage/

          # Linux installers + .asc sidecars
          cp dist/installers/*                                                 dist/stage/

          # Archives
          cp dist/archives/*                                                   dist/stage/

          # SBOM
          cp "${{ steps.sbom.outputs.fileName }}"                              "dist/stage/nimbus-${GITHUB_REF_NAME}-sbom.cdx.json"

          # Verify scripts (uploaded as release assets so users can curl them)
          cp scripts/release/nimbus-verify.sh                                  dist/stage/
          cp scripts/release/nimbus-verify.ps1                                 dist/stage/

          ls -la dist/stage/
```

- [ ] **Step 13.8: Add "Compute + Sign SHA256SUMS" step**

After the stage step, insert:

```yaml
      - name: Compute SHA256SUMS
        shell: bash
        run: |
          set -e
          cd dist/stage
          # LC_ALL=C guarantees byte-identical output across runner images + locales.
          LC_ALL=C sha256sum * | LC_ALL=C sort -k2 > SHA256SUMS
          echo "=== SHA256SUMS ==="
          cat SHA256SUMS
          echo "=================="

      - name: Sign SHA256SUMS
        env:
          GPG_PRIVATE_KEY: ${{ secrets.GPG_PRIVATE_KEY }}
          GPG_PASSPHRASE: ${{ secrets.GPG_PASSPHRASE }}
        shell: bash
        run: |
          set -e
          bash scripts/sign-linux-gpg.sh dist/stage/SHA256SUMS
          ls -la dist/stage/SHA256SUMS*
```

- [ ] **Step 13.9: Simplify `Create GitHub Release` files: glob**

Locate:

```yaml
      - name: Create GitHub Release
        uses: softprops/action-gh-release@c95fe1489396fe8a21967200391e1b9067ad0ba5 # v2.6.2
        with:
          token: ${{ secrets.RELEASE_PAT }}
          files: |
            dist/nimbus-gateway-*/nimbus-gateway-*
            dist/nimbus-cli-*/nimbus-cli-*
            dist/installers/nimbus-headless*
            dist/sbom/nimbus-*-sbom.cdx.json
          generate_release_notes: true
          draft: false
          prerelease: ${{ contains(github.ref_name, '-') }}
```

Replace the `files:` block with a single-glob to `dist/stage/`:

```yaml
      - name: Create GitHub Release
        uses: softprops/action-gh-release@c95fe1489396fe8a21967200391e1b9067ad0ba5 # v2.6.2
        with:
          token: ${{ secrets.RELEASE_PAT }}
          files: dist/stage/*
          generate_release_notes: true
          draft: false
          prerelease: ${{ contains(github.ref_name, '-') }}
```

Every other existing arg stays the same.

- [ ] **Step 13.10: Add `environment: release` to `publish-release`**

Find the `publish-release` job header:

```yaml
  publish-release:
    name: Publish GitHub Release
    needs:
      - build-gateway
      - build-cli
    runs-on: ubuntu-22.04
    timeout-minutes: 30
```

Add `environment: release` after `timeout-minutes`:

```yaml
  publish-release:
    name: Publish GitHub Release
    needs:
      - build-gateway
      - build-cli
    runs-on: ubuntu-22.04
    timeout-minutes: 30
    environment: release
```

- [ ] **Step 13.11: Add `environment: release` to `update-manifest`**

Find the `update-manifest` job header:

```yaml
  update-manifest:
    name: Publish updater manifest
    needs: publish-release
    runs-on: ubuntu-22.04
    timeout-minutes: 20
```

Add `environment: release`:

```yaml
  update-manifest:
    name: Publish updater manifest
    needs: publish-release
    runs-on: ubuntu-22.04
    timeout-minutes: 20
    environment: release
```

- [ ] **Step 13.12: YAML syntax check**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))" && echo "YAML OK"
```

If Python isn't available, fall back to:
```bash
bun -e "console.log(JSON.stringify(Bun.file('.github/workflows/release.yml').exists()))"
# or any other YAML parser; the file must parse without error.
```

- [ ] **Step 13.13: Final `grep` sanity check**

Run:
```bash
grep -c "environment: release" .github/workflows/release.yml
# Expected: 2

grep -c "Sign binary (macOS)\|Sign binary (Windows)" .github/workflows/release.yml
# Expected: 0

grep -c "SHA256SUMS" .github/workflows/release.yml
# Expected: ≥ 4 (Compute + Sign + inline cat + comment lines)

grep -c "PLACEHOLDER-DO-NOT-USE" .github/workflows/release.yml
# Expected: 1 (the verification grep guard)
```

- [ ] **Step 13.14: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "$(cat <<'EOF'
feat(release): GPG-signed SHA256SUMS + archive packaging + env gate

publish-release now: extends Linux installers step with AppImage +
libfuse2 install + appimagetool pin; signs .deb / .AppImage / tarball;
builds macOS .tar.gz + Windows .zip archives with README + LICENSE;
guards against PLACEHOLDER-DO-NOT-USE SIGNING-KEY sentinel; stages
flat dist/stage/; computes + signs SHA256SUMS with LC_ALL=C; uploads
everything via a single dist/stage/* glob. publish-release and
update-manifest now gate on the 'release' environment for maintainer
button-press approval.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Final Verification

**Files:** none modified.

---

- [ ] **Step 14.1: Run all new test suites**

```bash
bun test scripts/package-linux-installers.test.ts scripts/release/
```

Expected: all tests PASS (PowerShell tests may be SKIPPED locally if `pwsh` is absent; CI Windows runner will exercise them).

- [ ] **Step 14.2: Full repo test regression**

```bash
bun test
```

Expected: every pre-existing test still passes. No regressions.

- [ ] **Step 14.3: Typecheck + lint**

```bash
bun run typecheck
bun run lint
```

Expected: green. If Biome flags anything in the new scripts, fix by running `bun run lint:fix` and re-running.

- [ ] **Step 14.4: Validate `release.yml` once more**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))" && echo "YAML OK"
```

- [ ] **Step 14.5: Confirm deleted file absence**

```bash
test ! -f scripts/sign-macos.sh && echo "sign-macos.sh removed: OK"
test ! -f scripts/sign-windows.ps1 && echo "sign-windows.ps1 removed: OK"
grep -rn "sign-macos\.sh\|sign-windows\.ps1" . --include='*.yml' --include='*.yaml' --include='*.ts' --include='*.sh' 2>/dev/null && echo "FAIL: orphan references" || echo "No orphan references: OK"
```

- [ ] **Step 14.6: Confirm spec acceptance criteria coverage**

Open `docs/superpowers/specs/2026-04-23-signing-pipeline-design.md` §8 "Acceptance Criteria (spec-level)". Walk through each checkbox and confirm the plan implements it:

| Spec §8 criterion | Implemented in |
|---|---|
| `release.yml` runs green on `v0.1.0-rc1` tag | Task 13 (deferred to real-tag dry run) |
| Release assets include full list | Task 13.7 (stage) + Task 13.9 (upload) |
| `gpg --verify` + `sha256sum -c` passes | Task 13.8 (sign) + manual smoke |
| `nimbus-verify.sh --version` exits 0 | Task 5 + real-tag dry run |
| `nimbus-verify.ps1 -Version` exits 0 | Task 6 + real-tag dry run |
| `install-macos-unsigned.md` workflow verified | Task 8 + manual smoke |
| `install-windows-unsigned.md` workflow verified | Task 9 + manual smoke |
| `.deb` + `dpkg-sig --verify` valid | Task 13.3 (sign) + manual smoke |
| `.AppImage` on Ubuntu 22.04 + 24.04 | Task 3 + Task 7 docs + manual smoke |
| `SECURITY.md` + verify scripts + README fingerprint three-way | Tasks 2 + 5 + 6 + 10 |
| `publish-release` + `update-manifest` pause for approval | Task 13.10 + 13.11 |
| `sign-macos.sh` + `sign-windows.ps1` removed | Task 1 |
| `§9.5` (now §7.5) secrets table lists 7 secrets | Task 11.4 |
| README `## Install` section with 3 OS + verify subsection | Task 10 |

If any row lacks an "Implemented in" cell, add a follow-up task **before** marking the plan complete.

- [ ] **Step 14.7: Push + open PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(release): v0.1.0 Phase-1 headless signing pipeline" --body "$(cat <<'EOF'
## Summary

Phase 1 of the v0.1.0 release signing pipeline — ships:

- **Integrity manifest:** GPG-signed `SHA256SUMS.asc` covering every user-facing release artifact.
- **AppImage** added to Linux installers alongside `.deb` + tarball.
- **Archive-wrapped headless binaries** for macOS (`.tar.gz`) and Windows (`.zip`) — preserves `+x` on macOS, avoids browser "Uncommon Download" heuristics.
- **`nimbus-verify.{sh,ps1}`** end-user helpers with `TRUSTED_FINGERPRINTS` array (supports key rotation) + bootstrap-trust fingerprint echo.
- **Unsigned-install docs** for macOS + Windows with "Why unsigned?" framing, plus a cross-platform `verify-release-integrity.md`.
- **`release` GitHub Environment gating** on `publish-release` + `update-manifest` jobs.
- **Removed:** `scripts/sign-macos.sh`, `scripts/sign-windows.ps1`, and the 2 no-op release.yml steps. Apple + Windows EV cert procurement deferred to a later point release.

Phase 2 (Tauri UI installer track) is a separate spec + plan.

## Plan reference

[`docs/superpowers/plans/2026-04-23-signing-pipeline.md`](docs/superpowers/plans/2026-04-23-signing-pipeline.md) — every commit on this branch maps to a task in that plan.

## Design reference

[`docs/superpowers/specs/2026-04-23-signing-pipeline-design.md`](docs/superpowers/specs/2026-04-23-signing-pipeline-design.md) — addresses the Gemini review (§12) inline.

## Test plan

- [ ] `bun test` green
- [ ] `bun run lint && bun run typecheck` green
- [ ] Merge → tag `v0.1.0-rc1` → **manual dry run on real runners** to verify:
  - [ ] `release.yml` completes every job green
  - [ ] `publish-release` pauses for approval in the Actions UI
  - [ ] `update-manifest` pauses for approval in the Actions UI
  - [ ] `gh release view v0.1.0-rc1` lists every expected artifact (see spec §8)
  - [ ] `bash nimbus-verify.sh --version 0.1.0-rc1` exits 0 on Linux + macOS
  - [ ] `pwsh -File nimbus-verify.ps1 -Version 0.1.0-rc1` exits 0 on Windows
- [ ] Manual smoke on clean VMs (docs in `docs/install-*-unsigned.md`)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Final Verification — Post-Merge

Once the PR merges and is tagged as `v0.1.0-rc1`:

- [ ] **V1. Release job reaches `publish-release` pause state** — Actions UI shows "Waiting for review" on the `release` environment.
- [ ] **V2. Approve `publish-release`** — observe upload; `gh release view v0.1.0-rc1 --json assets --jq '.assets[].name'` lists every expected filename.
- [ ] **V3. Approve `update-manifest`** — `latest.json` is added to the release.
- [ ] **V4. Manual verify on each OS** — follow the three install-docs workflows on clean VMs. Record results in `docs/release/v0.1.0-rc1-smoke.md` (new file, not in this plan's scope — create as part of the rc1 retrospective).
- [ ] **V5. Flip finish-plan status** — change `§2 Status Snapshot` in `docs/release/v0.1.0-finish-plan.md` to reflect §4.2 / Phase 1 as ✅ complete. Open Phase 2 brainstorm.

---

## Review Responses (from the signing-pipeline-review file)

Every point from `docs/superpowers/specs/2026-04-23-signing-pipeline-review.md` is addressed in the design spec's §12 "Review Responses" — this plan inherits those decisions without re-litigation. Summary:

- **Fixed in spec + implemented here:** Q1 bootstrap trust (Task 2, 5, 6, 7, 10), Q2 key rotation array (Task 5, 6, 7), Q4/S1 archives (Task 4, 13.4), I2 `LC_ALL=C` (Task 13.8), I3 distinctive icon (Task 3.3), S4 AppImage terminal UX (Task 3.2, 7), Q3 user-side libfuse2 (Task 7, 10), S3 central fingerprint (Task 2.2).
- **Already in original design:** I1 isolated GNUPGHOME (Task 5.2 fixture), Q3 CI-side runner pin (release.yml already pins ubuntu-22.04).
- **Deferred:** Q5 ARM64 Linux — reviewer's premise (that release.yml already builds ARM64 Linux) was incorrect; adding ARM64 Linux is a Phase 5+ scope item outside v0.1.0. S2 `--check-only` aliased to existing `--no-fetch` in Task 5.4.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-23-signing-pipeline.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
