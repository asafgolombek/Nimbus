import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { type AuditEntry, LocalIndex, RAW_META_MAX_BYTES } from "./local-index.ts";

function openMemoryIndex(): LocalIndex {
  const db = new Database(":memory:");
  LocalIndex.ensureSchema(db);
  return new LocalIndex(db);
}

describe("LocalIndex", () => {
  test("ensureSchema is idempotent", () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    LocalIndex.ensureSchema(db);
    const row = db.query("PRAGMA user_version").get() as {
      user_version: number;
    };
    expect(row.user_version).toBe(2);
  });

  test("upsert and search by name via FTS5", () => {
    const idx = openMemoryIndex();
    idx.upsert({
      id: "a1",
      service: "filesystem",
      itemType: "file",
      name: "Quarterly report Q1.pdf",
    });
    idx.upsert({
      id: "a2",
      service: "filesystem",
      itemType: "file",
      name: "Holiday photos.zip",
    });

    const hits = idx.search({ name: "quarterly report", limit: 10 });
    expect(hits.map((h) => h.id)).toEqual(["a1"]);
  });

  test("search filters by service and itemType", () => {
    const idx = openMemoryIndex();
    idx.upsert({
      id: "x1",
      service: "fs",
      itemType: "file",
      name: "alpha",
    });
    idx.upsert({
      id: "x2",
      service: "other",
      itemType: "file",
      name: "alpha beta",
    });

    const onlyFs = idx.search({ name: "alpha", service: "fs" });
    expect(onlyFs.map((h) => h.id)).toEqual(["x1"]);

    const byType = idx.search({ itemType: "file", limit: 5 });
    expect(byType.length).toBe(2);
  });

  test("delete removes item", () => {
    const idx = openMemoryIndex();
    idx.upsert({
      id: "d1",
      service: "s",
      itemType: "file",
      name: "gone",
    });
    idx.delete("d1");
    expect(idx.search({ name: "gone" })).toEqual([]);
  });

  test("upsert rejects raw_meta over 64 KiB", () => {
    const idx = openMemoryIndex();
    const big = "x".repeat(RAW_META_MAX_BYTES);
    expect(() =>
      idx.upsert({
        id: "big",
        service: "s",
        itemType: "file",
        name: "n",
        rawMeta: { blob: big },
      }),
    ).toThrow(/exceeds 64 KB/);
  });

  test("recordSync and getLastSyncToken", () => {
    const idx = openMemoryIndex();
    idx.recordSync("filesystem", "token-a");
    expect(idx.getLastSyncToken("filesystem")).toBe("token-a");
    idx.recordSync("filesystem", "token-b");
    expect(idx.getLastSyncToken("filesystem")).toBe("token-b");
    expect(idx.getLastSyncToken("missing")).toBeNull();
  });

  test("recordAudit and listAudit order", () => {
    const idx = openMemoryIndex();
    const e1: Omit<AuditEntry, "id"> = {
      actionType: "file.delete",
      hitlStatus: "rejected",
      actionJson: '{"path":"/tmp/a"}',
      timestamp: 100,
    };
    const e2: Omit<AuditEntry, "id"> = {
      actionType: "filesystem.search",
      hitlStatus: "not_required",
      actionJson: "{}",
      timestamp: 200,
    };
    idx.recordAudit(e1);
    idx.recordAudit(e2);
    const list = idx.listAudit(10);
    expect(list.length).toBe(2);
    expect(list[0]?.actionType).toBe("filesystem.search");
    expect(list[1]?.actionType).toBe("file.delete");
  });
});
