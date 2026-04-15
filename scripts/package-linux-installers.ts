#!/usr/bin/env bun
/**
 * Build Linux release artifacts from the headless binary bundle (release packaging):
 * - `nimbus-headless-linux-amd64.tar.gz` — `bin/nimbus`, `bin/nimbus-gateway`
 * - `nimbus-headless_amd64.deb` — installs to `/usr/lib/nimbus/bin` + symlinks in `/usr/local/bin`
 *
 * Prerequisites: `tar`, `gzip`, `dpkg-deb` (Ubuntu/Debian CI images include these).
 *
 * Usage:
 *   bun scripts/package-linux-installers.ts
 *   bun scripts/package-linux-installers.ts --bundle dist/headless-bundle --version 0.2.0
 */
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

const bundleDir = resolve(repoRoot, parseArg("--bundle") ?? join("dist", "headless-bundle"));
const version = (parseArg("--version") ?? process.env["NIMBUS_RELEASE_VERSION"] ?? "0.0.0").replace(
  /^v/,
  "",
);
const outRoot = resolve(repoRoot, parseArg("--out") ?? join("dist", "installers"));

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

// --- tarball ---
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

// --- .deb ---
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

writeFileSync(join(debBin, "nimbus"), '#!/bin/sh\nexec /usr/lib/nimbus/bin/nimbus "$@"\n', "utf8");
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

rmSync(join(outRoot, "tar-stage"), { recursive: true, force: true });
rmSync(join(outRoot, "deb-stage"), { recursive: true, force: true });

console.log(`Linux installers written to ${outRoot}`);
console.log(`  ${tgzName}`);
console.log(`  ${debName}`);
