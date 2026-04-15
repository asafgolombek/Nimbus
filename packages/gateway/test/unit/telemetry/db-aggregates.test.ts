import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { LocalIndex } from "../../../src/index/local-index.ts";
import { collectTelemetryDbAggregates } from "../../../src/telemetry/db-aggregates.ts";

describe("collectTelemetryDbAggregates", () => {
  test("aggregates sync failures, durations, health transitions, extensions", () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const now = Date.now();
    db.run(
      `INSERT INTO sync_telemetry (service, started_at, duration_ms, items_upserted, items_deleted, bytes_transferred, had_more, error_msg)
       VALUES ('github', ?, 120, 0, 0, NULL, 0, 'timeout'),
              ('github', ?, 80, 0, 0, NULL, 0, NULL)`,
      [now - 1000, now - 2000],
    );
    db.run(
      `INSERT INTO connector_health_history (connector_id, from_state, to_state, reason, occurred_at)
       VALUES ('github', 'healthy', 'degraded', 'transient', ?)`,
      [now - 500],
    );
    db.run(
      `INSERT INTO extension (id, version, install_path, manifest_hash, entry_hash, enabled, installed_at, last_verified_at)
       VALUES ('ext.demo', '1.0.0', '/x', 'a', 'b', 1, ?, ?)`,
      [now, now],
    );

    const ag = collectTelemetryDbAggregates(db);
    expect(ag.connector_error_rate["github"]).toBe(1);
    expect(ag.sync_duration_p50_ms["github"]).toBe(100);
    expect(ag.connector_health_transitions["degraded"]).toBe(1);
    expect(ag.extension_installs_by_id["ext.demo"]).toBe(1);
  });
});
