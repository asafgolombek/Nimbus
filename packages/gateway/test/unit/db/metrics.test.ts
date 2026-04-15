import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { collectIndexMetrics } from "../../../src/db/metrics.ts";
import { LocalIndex } from "../../../src/index/local-index.ts";

describe("collectIndexMetrics", () => {
  test("aggregates item counts, sync timestamps, and embedding coverage", () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    db.run(
      `INSERT INTO item (id, service, type, external_id, title, body_preview, url, canonical_url, modified_at, author_id, metadata, synced_at, pinned)
       VALUES ('a:1', 'github', 'pr', '1', 't', NULL, NULL, NULL, 1, NULL, NULL, 1, 0),
              ('b:2', 'slack', 'message', '2', 'u', NULL, NULL, NULL, 2, NULL, NULL, 2, 0)`,
    );
    db.run(
      `INSERT INTO sync_state (connector_id, last_sync_at, next_sync_token, health_state, backoff_attempt)
       VALUES ('github', 1000, '', 'healthy', 0)`,
    );

    const m = collectIndexMetrics(db);
    expect(m.totalItems).toBe(2);
    expect(m.itemCountByService.github).toBe(1);
    expect(m.itemCountByService.slack).toBe(1);
    expect(m.embeddingCoveragePercent).toBe(0);
    expect(m.lastSuccessfulSyncByConnector.github?.getTime()).toBe(1000);
    expect(m.indexSizeBytes).toBeGreaterThanOrEqual(0);
    db.close();
  });
});
