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

// Create a bash stub script under workDir and return its path.
function makeStub(name: string, body: string): string {
  const p = join(workDir, name);
  writeFileSync(p, `#!/usr/bin/env bash\nset -e\n${body}\n`, "utf8");
  chmodSync(p, 0o755);
  return p;
}

// Run package-linux-installers.ts via the current Bun executable. Using process.execPath
// instead of "bun" avoids PATH-based tool hijacking (Sonar S4036).
function runInstaller(extraArgs: string[]) {
  return spawnSync(
    process.execPath,
    [
      "scripts/package-linux-installers.ts",
      "--bundle",
      bundleDir,
      "--out",
      outDir,
      "--version",
      "0.1.0-rc1",
      ...extraArgs,
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
}

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
  stubToolPath = makeStub("stub-appimagetool", `OUT="$2"\nprintf 'AITS' > "$OUT"`);
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

linuxTest("produces .deb with expected name", () => {
  const r = runInstaller(["--skip-appimage"]);
  expect(r.status).toBe(0);
  expect(existsSync(join(outDir, "nimbus-headless_0.1.0-rc1_amd64.deb"))).toBe(true);
});

linuxTest("produces tarball with expected name", () => {
  const r = runInstaller(["--skip-appimage"]);
  expect(r.status).toBe(0);
  expect(existsSync(join(outDir, "nimbus-headless-linux-amd64-v0.1.0-rc1.tar.gz"))).toBe(true);
});

linuxTest("produces .AppImage with stubbed appimagetool", () => {
  const r = runInstaller(["--appimagetool", stubToolPath]);
  expect(r.status).toBe(0);
  const appImage = join(outDir, "nimbus-headless-0.1.0-rc1-x86_64.AppImage");
  expect(existsSync(appImage)).toBe(true);
  const head = readFileSync(appImage).subarray(0, 4).toString();
  expect(head).toBe("AITS"); // stub's magic bytes — proves the tool was invoked with the right output path
});

linuxTest("populates AppDir with AppRun, .desktop, icon, and binaries before invoking tool", () => {
  const listingPath = join(workDir, "appdir-listing.txt");
  const recordingStub = makeStub(
    "recording-stub",
    `APPDIR="$1"\n(cd "$APPDIR" && find . -type f | sort) > "${listingPath}"\nprintf 'AITS' > "$2"`,
  );

  const r = runInstaller(["--appimagetool", recordingStub]);
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
  const desktopOut = join(workDir, "captured.desktop");
  const recordingStub = makeStub(
    "desktop-recording-stub",
    `APPDIR="$1"\ncp "$APPDIR/nimbus-headless.desktop" "${desktopOut}"\nprintf 'AITS' > "$2"`,
  );

  runInstaller(["--appimagetool", recordingStub]);

  const desktop = readFileSync(desktopOut, "utf8");
  expect(desktop).toContain("X-AppImage-Version=0.1.0-rc1");
  expect(desktop).not.toContain("{{VERSION}}");
});
