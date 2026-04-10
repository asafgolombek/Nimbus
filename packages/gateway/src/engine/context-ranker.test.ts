import { describe, expect, test } from "bun:test";

import type { RankedIndexItem } from "../index/ranked-item.ts";
import { buildContextWindow } from "./context-ranker.ts";

function fakeItem(
  service: string,
  indexedType: string,
  name: string,
  modifiedAt: number,
): RankedIndexItem {
  return {
    id: "x",
    service,
    itemType: "file",
    name,
    modifiedAt,
    score: 1,
    indexPrimaryKey: `${service}:x`,
    indexedType,
  };
}

describe("buildContextWindow", () => {
  test("splits top items and summarizes remainder", () => {
    const items: RankedIndexItem[] = [
      fakeItem("github", "pr", "a", 100),
      fakeItem("github", "pr", "b", 90),
      fakeItem("slack", "message", "c", 80),
      fakeItem("slack", "message", "d", 70),
    ];
    const w = buildContextWindow(items, 2);
    expect(w.totalMatches).toBe(4);
    expect(w.items).toHaveLength(2);
    expect(w.sourceSummary).toHaveLength(1);
    expect(w.sourceSummary[0]?.service).toBe("slack");
    expect(w.sourceSummary[0]?.type).toBe("message");
    expect(w.sourceSummary[0]?.count).toBe(2);
  });

  test("empty input", () => {
    const w = buildContextWindow([], 10);
    expect(w.items).toEqual([]);
    expect(w.sourceSummary).toEqual([]);
    expect(w.totalMatches).toBe(0);
  });
});
