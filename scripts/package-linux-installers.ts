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

function printUsage(): void {
  console.log(`Usage: bun scripts/package-linux-installers.ts [options]

Builds Linux release artifacts from a headless bundle directory:
  - nimbus-headless-linux-amd64-v<ver>.tar.gz
  - nimbus-headless_<ver>_amd64.deb
  - nimbus-headless-<ver>-x86_64.AppImage

Options:
  --bundle <dir>          Input: directory containing nimbus + nimbus-gateway
                          (default: dist/headless-bundle — emitted by
                          scripts/package-headless-bundle.ts)
  --out <dir>             Output directory (default: dist/installers; wiped
                          clean before writing)
  --version <ver>         Version string used in artifact names. Leading 'v'
                          stripped. (default: $NIMBUS_RELEASE_VERSION or 0.0.0)
  --appimagetool <path>   Path to an appimagetool binary. If omitted, falls
                          back to /usr/local/bin/appimagetool. Required when
                          --skip-appimage is not set.
  --skip-appimage         Produce only .deb + tarball. Useful for tests and
                          offline builds.
  --help, -h              Show this message.

Prerequisites: /usr/bin/tar, /usr/bin/dpkg-deb, and (unless --skip-appimage)
an appimagetool binary. libfuse2 is required at runtime of appimagetool — on
Ubuntu 22.04 install via 'sudo apt install libfuse2'; on Ubuntu 24.04+ install
libfuse2t64 or pass --skip-appimage and build AppImage elsewhere.
`);
}

if (hasFlag("--help") || hasFlag("-h")) {
  printUsage();
  process.exit(0);
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

function buildAppImage(toolPath: string): string {
  const appDirName = `nimbus-headless-${version}.AppDir`;
  const appDir = join(outRoot, appDirName);
  const usrBin = join(appDir, "usr", "bin");
  const usrShare = join(appDir, "usr", "share", "applications");

  mkdirSync(usrBin, { recursive: true });
  mkdirSync(usrShare, { recursive: true });

  // Binaries
  copyFileSync(gw, join(usrBin, "nimbus-gateway"));
  copyFileSync(cli, join(usrBin, "nimbus"));
  chmodSync(join(usrBin, "nimbus-gateway"), 0o755);
  chmodSync(join(usrBin, "nimbus"), 0o755);

  // AppRun shim (must be at AppDir root, executable)
  const appRunSrc = join(repoRoot, "scripts", "linux", "nimbus-headless.AppRun");
  const appRunDst = join(appDir, "AppRun");
  copyFileSync(appRunSrc, appRunDst);
  chmodSync(appRunDst, 0o755);

  // Desktop entry with {{VERSION}} substituted
  const desktopSrc = join(repoRoot, "scripts", "linux", "nimbus-headless.desktop");
  const desktopContent = readFileSync(desktopSrc, "utf8").replaceAll("{{VERSION}}", version);
  const desktopDst = join(appDir, "nimbus-headless.desktop");
  writeFileSync(desktopDst, desktopContent, "utf8");
  // Copy to usr/share/applications as well (FreeDesktop convention)
  writeFileSync(join(usrShare, "nimbus-headless.desktop"), desktopContent, "utf8");

  // Icon (must be at AppDir root with same base name as desktop Icon= field)
  const iconSrc = join(repoRoot, "scripts", "linux", "nimbus-headless.png");
  copyFileSync(iconSrc, join(appDir, "nimbus-headless.png"));

  const appImageName = `nimbus-headless-${version}-x86_64.AppImage`;
  const appImagePath = join(outRoot, appImageName);

  const result = spawnSync(toolPath, [appDir, appImagePath], {
    stdio: "inherit",
    cwd: repoRoot,
  });
  if (result.status !== 0) {
    console.error(
      `package-linux-installers: appimagetool failed (exit ${result.status ?? "null"})`,
    );
    process.exit(result.status ?? 1);
  }
  rmSync(appDir, { recursive: true, force: true });
  return appImagePath;
}

const tgzPath = buildTarball();
const debPath = buildDeb();
console.log(`Linux installers written to ${outRoot}`);
console.log(`  ${tgzPath}`);
console.log(`  ${debPath}`);

if (!skipAppImage) {
  const toolPath = appImageToolOverride ?? "/usr/local/bin/appimagetool";
  if (!appImageToolOverride && !existsSync(toolPath)) {
    console.error(
      `package-linux-installers: appimagetool not found at ${toolPath}.\n` +
        `Pass --appimagetool <path> or --skip-appimage.\n` +
        `Download: https://appimage.github.io/appimagetool/`,
    );
    process.exit(1);
  }
  const appImagePath = buildAppImage(toolPath);
  console.log(`  ${appImagePath}`);
}
