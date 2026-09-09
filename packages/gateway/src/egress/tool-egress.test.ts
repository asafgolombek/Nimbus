import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { CURRENT_SCHEMA_VERSION } from "../index/local-index.ts";
import { runIndexedSchemaMigrations } from "../index/migrations/runner.ts";
import { verifyEgressChain } from "./egress-verify.ts";
import { recordToolEgress } from "./tool-egress.ts";

function freshDb(): Database {
  const db = new Database(":memory:");
  runIndexedSchemaMigrations(db, CURRENT_SCHEMA_VERSION);
  return db;
}

describe("recordToolEgress", () => {
  test("appends one chained row with source_type 'tool'", () => {
    const db = freshDb();
    recordToolEgress(db, {
      toolId: "tg_abc",
      destination: "api.example.com",
      method: "tool.fetch",
      resultStatus: "authorized",
      now: 1_700_000_000_000,
      requestMethod: "GET",
      requestBytes: 12,
    });
    const row = db
      .query<
        {
          source_type: string;
          source_id: string;
          destination: string;
          result_status: string;
          payload_summary: string;
        },
        []
      >(
        "SELECT source_type, source_id, destination, result_status, payload_summary FROM egress_ledger ORDER BY id DESC LIMIT 1",
      )
      .get();
    expect(row?.source_type).toBe("tool");
    expect(row?.source_id).toBe("tg_abc");
    expect(row?.destination).toBe("api.example.com");
    expect(row?.result_status).toBe("authorized");
    expect(verifyEgressChain(db).ok).toBe(true);
    db.close();
  });

  test("payload_summary carries the request method and byte COUNT, never a URL or body", () => {
    const db = freshDb();
    recordToolEgress(db, {
      toolId: "tg_abc",
      destination: "api.example.com",
      method: "tool.fetch",
      resultStatus: "authorized",
      now: 1,
      requestMethod: "POST",
      requestBytes: 4096,
    });
    const row = db
      .query<{ payload_summary: string }, []>(
        "SELECT payload_summary FROM egress_ledger ORDER BY id DESC LIMIT 1",
      )
      .get();
    const summary = row?.payload_summary ?? "";
    expect(summary).toContain("POST");
    expect(summary).toContain("4096");
    expect(summary).not.toContain("https://");
    expect(summary).not.toContain("/v1/");
    db.close();
  });

  test("a blocked destination still appends a row", () => {
    const db = freshDb();
    recordToolEgress(db, {
      toolId: "tg_abc",
      destination: "evil.example.com",
      method: "tool.fetch",
      resultStatus: "blocked",
      now: 1,
    });
    const row = db
      .query<{ result_status: string }, []>(
        "SELECT result_status FROM egress_ledger ORDER BY id DESC LIMIT 1",
      )
      .get();
    expect(row?.result_status).toBe("blocked");
    db.close();
  });
});
