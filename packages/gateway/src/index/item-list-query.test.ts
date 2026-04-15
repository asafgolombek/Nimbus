import { describe, expect, test } from "bun:test";

import { buildItemListSql, parseRelativeSinceToWindowMs } from "./item-list-query.ts";

describe("buildItemListSql", () => {
  test("matches IPC-style github + pr + since + limit", () => {
    const { sql, vals } = buildItemListSql({
      services: ["github"],
      types: ["pr"],
      sinceMs: 1_700_000_000_000,
      limit: 50,
    });
    expect(sql).toContain("service IN (?)");
    expect(sql).toContain("type = ?");
    expect(sql).toContain("modified_at >= ?");
    expect(vals).toEqual(["github", "pr", 1_700_000_000_000, 50]);
  });
});

describe("parseRelativeSinceToWindowMs", () => {
  test("7d window from fixed now", () => {
    const now = 1_800_000_000_000;
    const got = parseRelativeSinceToWindowMs("7d", now);
    expect(got).toBe(now - 7 * 24 * 60 * 60 * 1000);
  });
});
