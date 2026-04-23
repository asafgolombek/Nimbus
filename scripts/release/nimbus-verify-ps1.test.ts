/// <reference types="bun-types" />
import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const toUnix = (p: string) => p.replace(/\\/g, "/");
const toMsys2 = (p: string) =>
  p.replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`).replace(/\\/g, "/");
const VERIFY_PS1 = toUnix(join(REPO_ROOT, "scripts", "release", "nimbus-verify.ps1"));
const GEN_KEY = toUnix(join(REPO_ROOT, "scripts", "release", "fixtures", "gen-test-key.sh"));

// Skip entirely if pwsh (PowerShell 7+) is not on PATH. `nimbus-verify.ps1`
// targets PowerShell 7+ per its .NOTES; Windows PowerShell 5.1 is intentionally
// NOT supported (it predates modern .NET JSON handling and cross-platform tooling).
// Systems without pwsh skip these tests cleanly; CI Windows/macOS/Linux runners
// all have pwsh available.
const HAS_PWSH = (() => {
  const r = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["pwsh"], {
    encoding: "utf8",
  });
  return r.status === 0;
})();

if (!HAS_PWSH) {
  // Surface the skip reason once so a developer running tests locally without
  // pwsh knows WHY their PS1 tests were skipped (test.skipIf doesn't carry a reason).
  console.warn(
    "[nimbus-verify.ps1 tests] SKIPPED: 'pwsh' (PowerShell 7+) not found on PATH.\n" +
      "  - Install hint: macOS 'brew install powershell', Linux via https://learn.microsoft.com/powershell/,\n" +
      "    Windows 'winget install Microsoft.PowerShell'.\n" +
      "  - Windows PowerShell 5.1 (built-in, powershell.exe) is NOT supported for nimbus-verify.ps1.",
  );
}

let work: string;
let gnupghome: string;
let cwd: string;
let fingerprint: string;

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", VERIFY_PS1, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GNUPGHOME: toMsys2(gnupghome),
      NIMBUS_VERIFY_FINGERPRINT_OVERRIDE: fingerprint,
    },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

beforeEach(() => {
  if (!HAS_PWSH) return;
  work = mkdtempSync(join(tmpdir(), "nimbus-verify-ps1-"));
  gnupghome = join(work, "gnupg");
  cwd = join(work, "cwd");
  mkdirSync(cwd, { recursive: true });

  const genRes = spawnSync("bash", [GEN_KEY, toMsys2(gnupghome)], { encoding: "utf8" });
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
      toUnix(join(cwd, "SHA256SUMS.asc")),
      toUnix(join(cwd, "SHA256SUMS")),
    ],
    { env: { ...process.env, GNUPGHOME: toMsys2(gnupghome) } },
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
