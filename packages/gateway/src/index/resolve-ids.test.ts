import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { RESOLVE_IDS_MAX_BATCH, resolveItemsByIds } from "./resolve-ids.ts";

type Row = {
  id: string;
  service: string;
  type: string;
  title: string;
  url: string | null;
  canonical_url: string | null;
  modified_at: number;
};

function seed(): Database {
  const db = new Database(":memory:");
  // Lightweight DDL in the sibling's style — every column this module reads, plus
  // `canonical_url`, which the sibling has no reason to declare and this one does.
  db.exec(`CREATE TABLE item (id TEXT PRIMARY KEY, service TEXT, type TEXT, title TEXT,
    url TEXT, canonical_url TEXT, modified_at INTEGER)`);
  const insert = (r: Row) =>
    db
      .query(
        `INSERT INTO item (id, service, type, title, url, canonical_url, modified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.id, r.service, r.type, r.title, r.url, r.canonical_url, r.modified_at);
  insert({
    id: "github:acme/web#1",
    service: "github",
    type: "pull_request",
    title: "Auth rewrite",
    url: "https://example.test/pr/1",
    canonical_url: null,
    modified_at: 1_700_000_000_000,
  });
  insert({
    id: "jira:PLAT-9",
    service: "jira",
    type: "issue",
    title: "Latency",
    url: null,
    canonical_url: null,
    modified_at: 1_700_000_000_001,
  });
  insert({
    id: "nimbus:brief-7",
    service: "nimbus",
    type: "research_brief",
    title: "A saved brief",
    url: null,
    canonical_url: "https://example.test/canon/7",
    modified_at: 1_700_000_000_002,
  });
  return db;
}

describe("resolveItemsByIds", () => {
  test("returns the exact six-field projection and nothing else", () => {
    const [row] = resolveItemsByIds(seed(), ["github:acme/web#1"]);
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "id",
      "modified_at",
      "service",
      "title",
      "type",
      "url",
    ]);
    expect(row?.url).toBe("https://example.test/pr/1");
  });

  test("omits ids the index does not hold, without erroring", () => {
    const rows = resolveItemsByIds(seed(), ["github:acme/web#1", "github:nope#404"]);
    expect(rows.map((r) => r.id)).toEqual(["github:acme/web#1"]);
  });

  test("keeps url null when the row has neither url nor canonical_url", () => {
    const [row] = resolveItemsByIds(seed(), ["jira:PLAT-9"]);
    // Null must survive to the caller: the client renders the title as plain
    // text. Substituting anything here would fabricate a reference.
    expect(row?.url).toBeNull();
  });

  test("falls back to canonical_url only when url is null", () => {
    const [row] = resolveItemsByIds(seed(), ["nimbus:brief-7"]);
    expect(row?.url).toBe("https://example.test/canon/7");
  });

  test("prefers url over canonical_url when both exist", () => {
    const db = seed();
    db.query("UPDATE item SET canonical_url = ? WHERE id = ?").run(
      "https://example.test/canon/1",
      "github:acme/web#1",
    );
    const [row] = resolveItemsByIds(db, ["github:acme/web#1"]);
    // The sibling route returns the bare `url` column; matching it matters more
    // than matching resolve_key's canonical-first derivation. Spec §4.
    expect(row?.url).toBe("https://example.test/pr/1");
  });

  test("de-duplicates repeated ids into one row", () => {
    const rows = resolveItemsByIds(seed(), ["jira:PLAT-9", "jira:PLAT-9", "jira:PLAT-9"]);
    expect(rows).toHaveLength(1);
  });

  test("returns an empty array for an empty id list", () => {
    expect(resolveItemsByIds(seed(), [])).toEqual([]);
  });

  // This pin is weaker than it reads: SQLite answers an `IN (…)` lookup in primary-key index
  // order regardless of `ORDER BY`, and neither the seed order above nor the requested-id order
  // here differs from the sorted order, so this would likely still pass with `ORDER BY id`
  // deleted from the query. No seeding or request order distinguishes the two paths. `ORDER BY
  // id` stays anyway — it is still a wire contract (two deterministic orders are still two
  // different responses) — and this test stays as the closest available pin, not a stronger one.
  test("orders deterministically by id", () => {
    const rows = resolveItemsByIds(seed(), ["nimbus:brief-7", "github:acme/web#1", "jira:PLAT-9"]);
    expect(rows.map((r) => r.id)).toEqual([...rows.map((r) => r.id)].sort());
  });

  test("throws above the batch cap rather than truncating", () => {
    const ids = Array.from({ length: RESOLVE_IDS_MAX_BATCH + 1 }, (_, i) => `x:${i}`);
    expect(() => resolveItemsByIds(seed(), ids)).toThrow();
  });

  test("treats an id containing SQL syntax as data, not as SQL", () => {
    const db = seed();
    const rows = resolveItemsByIds(db, ["github:acme/web#1'); DROP TABLE item; --"]);
    expect(rows).toEqual([]);
    // The table is still there — reuses the SAME `db` handle above, not a fresh `seed()`. A fresh
    // `seed()` constructs a brand-new `:memory:` database and would pass even if the first call
    // had dropped the table, proving nothing.
    expect(resolveItemsByIds(db, ["jira:PLAT-9"])).toHaveLength(1);
  });

  test("throws above the batch cap counted before de-duplication", () => {
    // 101 copies of a single id must be refused — the cap check happens before
    // de-duplication, not after.
    const ids = Array.from({ length: RESOLVE_IDS_MAX_BATCH + 1 }, () => "jira:PLAT-9");
    expect(() => resolveItemsByIds(seed(), ids)).toThrow();
  });
});
