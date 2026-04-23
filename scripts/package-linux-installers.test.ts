/// <reference types="bun-types" />
import { afterEach, beforeEach, expect, test } from "bun:test";

// dpkg-deb, appimagetool, and the AppImage FUSE runtime are Linux-only prerequisites.
// These tests are designed to run on ubuntu-22.04 CI; skip gracefully on other platforms.
const linuxTest = process.platform === "linux" ? test : test.skip;

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

linuxTest("produces .deb with expected name", () => {
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

linuxTest("produces tarball with expected name", () => {
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

linuxTest("produces .AppImage with stubbed appimagetool", () => {
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

linuxTest("populates AppDir with AppRun, .desktop, icon, and binaries before invoking tool", () => {
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

linuxTest("substitutes {{VERSION}} placeholder in desktop entry", () => {
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
