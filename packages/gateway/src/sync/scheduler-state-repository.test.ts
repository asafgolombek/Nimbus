import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { LocalIndex } from "../index/local-index.ts";
import { SqliteSchedulerStateRepository } from "./scheduler-state-repository.ts";

describe("SqliteSchedulerStateRepository", () => {
  test("round-trips scheduler_state via loadState and upsertRegistration", () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const repo = new SqliteSchedulerStateRepository(db);
    expect(repo.loadState("github")).toBeNull();
    repo.upsertRegistration("github", 60_000, Date.now(), false);
    const row = repo.loadState("github");
    expect(row).not.toBeNull();
    expect(row?.service_id).toBe("github");
    expect(row?.interval_ms).toBe(60_000);
    db.close();
  });
});
