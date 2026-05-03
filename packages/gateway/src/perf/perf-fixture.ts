/**
 * Synthetic SQLite snapshot generator for perf fixtures.
 * Deterministic from a fixed PRNG seed; lazy-cached under cacheDir.
 *
 * See the B2 perf audit design §3.5 for the
 * corpus rationale.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CorpusTier } from "./types.ts";

export const FIXTURE_TIER_SIZES = {
  small: 10_000,
  medium: 100_000,
  large: 1_000_000,
} as const satisfies Record<CorpusTier, number>;

export const FIXTURE_SEED = 0x12345678;
export const FIXTURE_TIMESTAMP = 1704067200000; // 2024-01-01T00:00:00Z

export interface BuildOptions {
  /** Override default cache dir (`<tmpdir>/nimbus-bench-fixtures`). */
  cacheDir?: string;
}

function defaultCacheDir(): string {
  return join(tmpdir(), "nimbus-bench-fixtures");
}

/** Mulberry32 — small deterministic PRNG; fine for fixture generation. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Minimal DDL for the `item` table used by perf fixtures.
 *
 * We intentionally avoid calling `LocalIndex.ensureSchema` here. That function
 * loads the sqlite-vec native extension (a DLL/dylib). On Windows, a loaded
 * DLL is file-locked for the lifetime of the process, which causes `EBUSY`
 * errors when tests try to `rmSync` the temp directory after the Database is
 * closed. The fixture only needs the `item` table — it does not exercise
 * vector search — so we create only that table.
 */
const FIXTURE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS item (
  id              TEXT PRIMARY KEY,
  service         TEXT NOT NULL,
  type            TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  title           TEXT NOT NULL,
  body_preview    TEXT,
  url             TEXT,
  canonical_url   TEXT,
  modified_at     INTEGER NOT NULL,
  author_id       TEXT,
  metadata        TEXT,
  synced_at       INTEGER NOT NULL,
  pinned          INTEGER NOT NULL DEFAULT 0,
  UNIQUE(service, external_id)
);
CREATE INDEX IF NOT EXISTS idx_item_service     ON item(service);
CREATE INDEX IF NOT EXISTS idx_item_type        ON item(type);
CREATE INDEX IF NOT EXISTS idx_item_modified_at ON item(modified_at);
`;

/**
 * Build (or reuse) a synthetic index snapshot for the given tier.
 * Returns the absolute path to a SQLite file.
 */
export async function buildSyntheticIndex(
  tier: CorpusTier,
  opts: BuildOptions = {},
): Promise<string> {
  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  const path = join(cacheDir, `${tier}-${FIXTURE_SEED.toString(16)}.sqlite`);
  if (existsSync(path)) {
    return path;
  }

  const rows = FIXTURE_TIER_SIZES[tier];
  const db = new Database(path);
  try {
    db.exec(FIXTURE_SCHEMA_SQL);
    const rng = makeRng(FIXTURE_SEED);
    const ins = db.prepare(
      `INSERT INTO item (id, service, type, external_id, title, body_preview, url, modified_at, synced_at, pinned)
       VALUES (?, 'github', 'pr', ?, ?, '', '', ?, ?, 0)`,
    );
    const now = FIXTURE_TIMESTAMP;
    db.run("BEGIN");
    for (let i = 0; i < rows; i += 1) {
      const t = Math.floor(rng() * 1_000_000);
      ins.run(`gh:${i}`, String(i), `Synthetic PR ${i}`, now - t, now - t);
    }
    db.run("COMMIT");
    // Finalize the prepared statement before closing the DB. On Windows,
    // un-finalized statements keep the file handle open even after db.close(),
    // causing EBUSY when tests attempt to rmSync the temp directory.
    ins.finalize();
  } finally {
    db.close();
  }
  return path;
}
