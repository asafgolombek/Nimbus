import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { driftHintsFromIndex } from "./drift-hints.ts";
import { LocalIndex } from "./local-index.ts";

describe("driftHintsFromIndex", () => {
  test("mentions lambda count and IaC hint when no heartbeat", () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const lines = driftHintsFromIndex(db);
    expect(lines.some((l) => l.includes("Lambda"))).toBe(true);
    expect(lines.some((l) => l.includes("heartbeat"))).toBe(true);
  });

  test("compares snapshot when heartbeat present", () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const t = Date.now();
    db.run(
      `INSERT INTO item (id, service, type, external_id, title, body_preview, url, canonical_url, modified_at, author_id, metadata, synced_at, pinned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["aws:fn1", "aws", "lambda_function", "fn1", "f", "", null, null, t, null, "{}", t, 0],
    );
    db.run(
      `INSERT INTO item (id, service, type, external_id, title, body_preview, url, canonical_url, modified_at, author_id, metadata, synced_at, pinned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "iac:drift_baseline",
        "iac",
        "sync_heartbeat",
        "drift_baseline",
        "h",
        "x",
        null,
        null,
        t,
        null,
        JSON.stringify({ awsLambdaIndexedCount: 0, tick: 1 }),
        t,
        0,
      ],
    );
    const lines = driftHintsFromIndex(db);
    expect(lines.some((l) => l.includes("differs"))).toBe(true);
  });
});
