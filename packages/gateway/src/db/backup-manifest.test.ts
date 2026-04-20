import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blake3HashFile, buildManifest, verifyManifest } from "./backup-manifest.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "nimbus-backup-"));
}

describe("backup manifest", () => {
  test("blake3HashFile returns 64-char hex", async () => {
    const dir = tmp();
    const p = join(dir, "x.bin");
    writeFileSync(p, "hello");
    expect(await blake3HashFile(p)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("buildManifest records per-file hashes and counts", async () => {
    const dir = tmp();
    const idxPath = join(dir, "index.db.gz");
    writeFileSync(idxPath, "FAKE");
    const m = await buildManifest({
      bundleDir: dir,
      nimbusVersion: "0.1.0",
      schemaVersion: 21,
      platform: "linux",
      contents: {
        index_rows: 5,
        vault_entries: 1,
        watchers: 0,
        workflows: 0,
        extensions: 0,
        profiles: 0,
      },
      files: { "index.db.gz": idxPath },
      indexIncluded: true,
    });
    expect(m.hashes["index.db.gz"]).toMatch(/^[0-9a-f]{64}$/);
    expect(m.contents.index_rows).toBe(5);
    expect(m.contents.index_included).toBe(true);
  });

  test("buildManifest populates version=2 and schema_version when supplied", async () => {
    const dir = tmp();
    const p = join(dir, "test.bin");
    writeFileSync(p, "hello");
    const m = await buildManifest({
      bundleDir: dir,
      nimbusVersion: "0.1.0",
      schemaVersion: 21,
      platform: "linux",
      contents: {
        index_rows: 0,
        vault_entries: 1,
        watchers: 0,
        workflows: 0,
        extensions: 0,
        profiles: 1,
      },
      files: { "test.bin": p },
      indexIncluded: false,
    });
    expect(m.version).toBe(2);
    expect(m.schema_version).toBe(21);
  });

  test("verifyManifest accepts both version=1 (legacy) and version=2 (current) shapes", async () => {
    const dir = tmp();
    const p = join(dir, "x.bin");
    writeFileSync(p, "hello");
    const m1 = {
      version: 1 as const,
      nimbus_version: "0.0.9",
      created_at: "2026-01-01T00:00:00Z",
      platform: "linux" as const,
      contents: {
        index_rows: 0,
        index_included: false,
        vault_entries: 0,
        watchers: 0,
        workflows: 0,
        extensions: 0,
        profiles: 0,
      },
      hashes: { "x.bin": await blake3HashFile(p) },
    };
    const r1 = await verifyManifest(m1, { "x.bin": p });
    expect(r1.ok).toBe(true);
  });

  test("verifyManifest rejects a tampered file", async () => {
    const dir = tmp();
    const p = join(dir, "f.bin");
    writeFileSync(p, "good");
    const m = await buildManifest({
      bundleDir: dir,
      nimbusVersion: "0.1.0",
      schemaVersion: 21,
      platform: "linux",
      contents: {
        index_rows: 0,
        vault_entries: 0,
        watchers: 0,
        workflows: 0,
        extensions: 0,
        profiles: 0,
      },
      files: { "f.bin": p },
      indexIncluded: false,
    });
    writeFileSync(p, "tampered");
    const result = await verifyManifest(m, { "f.bin": p });
    expect(result.ok).toBe(false);
    expect(result.firstMismatch).toBe("f.bin");
  });
});
