/// <reference types="bun-types" />
import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// nimbus-verify.sh requires bash + gpg, which are native on Linux/macOS.
// On Windows the tests skip — the PowerShell equivalent is in nimbus-verify-ps1.test.ts.
const shellTest = process.platform === "win32" ? test.skip : test;

const REPO_ROOT = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
// Use forward slashes so paths are valid for bash on all platforms.
const toUnix = (p: string) => p.replaceAll("\\", "/");
const VERIFY_SH = toUnix(join(REPO_ROOT, "scripts", "release", "nimbus-verify.sh"));
const GEN_KEY = toUnix(join(REPO_ROOT, "scripts", "release", "fixtures", "gen-test-key.sh"));

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

shellTest("exits 0 for valid chain with --no-fetch", () => {
  const r = run(["--no-fetch"]);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("✅");
  expect(r.stdout).toContain("hello.bin");
});

shellTest("exits 1 when SHA256SUMS is tampered", () => {
  const manifest = readFileSync(join(cwd, "SHA256SUMS"), "utf8");
  // Flip one hex char in the hash.
  const tampered = manifest.replace(/^[0-9a-f]/, (c) => (c === "a" ? "b" : "a"));
  writeFileSync(join(cwd, "SHA256SUMS"), tampered, "utf8");
  const r = run(["--no-fetch"]);
  expect(r.status).toBe(1);
  expect(r.stdout + r.stderr).toMatch(/signature|MISMATCH|❌/i);
});

shellTest("exits 1 when SHA256SUMS is correct but hash doesn't match file", () => {
  // Regenerate SHA256SUMS for a DIFFERENT file, then re-sign, then swap file content.
  writeFileSync(join(cwd, "hello.bin"), "different content", "utf8");
  const r = run(["--no-fetch"]);
  expect(r.status).toBe(1);
  expect(r.stdout + r.stderr).toMatch(/hash|MISMATCH|❌/);
});

shellTest("exits 1 when SHA256SUMS.asc is signed by untrusted key", () => {
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

shellTest("exits 2 when SHA256SUMS missing with --no-fetch", () => {
  rmSync(join(cwd, "SHA256SUMS"));
  const r = run(["--no-fetch"]);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/SHA256SUMS/);
});

shellTest("prints imported fingerprint for bootstrap trust check", () => {
  const r = run(["--no-fetch"]);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain(fingerprint);
});
