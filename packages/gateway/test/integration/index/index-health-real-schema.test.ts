import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectIndexHealth } from "../../../src/db/index-health.ts";
import { upsertIndexedItem } from "../../../src/index/item-store.ts";
import { CURRENT_SCHEMA_VERSION } from "../../../src/index/local-index.ts";
import { runIndexedSchemaMigrations } from "../../../src/index/migrations/runner.ts";

/**
 * `collectIndexHealth` against the REAL migrated schema and the REAL write path.
 *
 * The unit tests in `src/db/index-health.test.ts` build a hand-written minimal table, which is fast
 * and readable and structurally CANNOT catch the one class of bug that matters most here: a column
 * that does not exist on the live `item` table. That is not hypothetical — the v0.1.1 spec this
 * feature came from named `raw_meta`, which is a column of the LEGACY `items` table and has never
 * existed on `item`. A query written from the spec would have thrown at runtime and passed every
 * unit test.
 *
 * So this test writes through `upsertIndexedItem` — the same function every connector's sync uses —
 * and asserts the report reads it back.
 */
describe("collectIndexHealth — real migrated schema", () => {
  let dir: string;
  let db: Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nimbus-index-health-"));
    db = new Database(join(dir, "nimbus.db"));
    runIndexedSchemaMigrations(db, CURRENT_SCHEMA_VERSION);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 0, retryDelay: 0 });
    } catch {
      /* non-fatal — see migration-v27.test.ts */
    }
  });

  it("runs against the live column set without throwing", () => {
    // The bare smoke assertion, and the one that would have caught `raw_meta`: every query in the
    // module executes against the real table.
    const h = collectIndexHealth(db, { nowMs: Date.now() });
    expect(h.totalItems).toBe(0);
    expect(h.confidence).toBeNull();
  });

  it("counts an item written through the production write path", () => {
    const now = Date.now();
    upsertIndexedItem(db, {
      service: "github",
      type: "pr",
      externalId: "1",
      title: "a pr",
      url: "https://example.com/pr/1",
      modifiedAt: now,
      metadata: { a: 1 },
      syncedAt: now,
    });
    const h = collectIndexHealth(db, { nowMs: now });
    expect(h.totalItems).toBe(1);
    const gh = h.connectors.find((c) => c.service === "github");
    expect(gh?.items).toBe(1);
    // No sync_state row was written, so it is stale for that reason — fail-closed, and the report
    // says which reason rather than implying a threshold breach.
    expect(gh?.staleReason).toBe("no_sync_record");
  });

  it("detects the modified_at ZERO sentinel the real write path produces", () => {
    // `item.modified_at` is NOT NULL, so "missing" can only ever be the sentinel `0` that
    // `item-store.ts` writes when a connector supplies neither modifiedAt nor createdAt. This
    // asserts that end to end rather than trusting the reading of one line.
    const now = Date.now();
    upsertIndexedItem(db, {
      service: "github",
      type: "pr",
      externalId: "2",
      title: "no dates",
      url: "https://example.com/pr/2",
      modifiedAt: 0,
      metadata: { a: 1 },
      syncedAt: now,
    });
    const h = collectIndexHealth(db, { nowMs: now });
    const pr = h.sparseTypes.find((t) => t.type === "pr");
    expect(pr?.missingModifiedAt).toBe(1);
  });

  it("treats a null url written through the real path as sparse", () => {
    const now = Date.now();
    upsertIndexedItem(db, {
      service: "jira",
      type: "ticket",
      externalId: "3",
      title: "no url",
      url: null,
      modifiedAt: now,
      metadata: { a: 1 },
      syncedAt: now,
    });
    const h = collectIndexHealth(db, { nowMs: now });
    const t = h.sparseTypes.find((x) => x.type === "ticket");
    expect(t?.missingUrl).toBe(1);
    expect(t?.sparseItems).toBe(1);
  });

  it("an item with a populated metadata object is NOT counted as missing metadata", () => {
    // `upsertIndexedItem` always writes SOME JSON (`{}` when no metadata is supplied), so the
    // empty-object case is what a connector supplying nothing actually looks like on disk. It is
    // deliberately NOT flagged: `{}` is a written value, and flagging it would mark most of a
    // healthy index sparse.
    const now = Date.now();
    upsertIndexedItem(db, {
      service: "jira",
      type: "ticket",
      externalId: "4",
      title: "empty meta",
      url: "https://example.com/t/4",
      modifiedAt: now,
      syncedAt: now,
    });
    const h = collectIndexHealth(db, { nowMs: now });
    expect(h.sparseTypes.find((x) => x.type === "ticket")).toBeUndefined();
  });
});
