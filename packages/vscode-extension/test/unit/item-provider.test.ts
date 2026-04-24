import { describe, expect, test } from "vitest";

import { formatItemMarkdown, parseItemUri } from "../../src/search/item-provider.js";

describe("parseItemUri", () => {
  test("extracts itemId from nimbus-item: URI", () => {
    const id = parseItemUri("nimbus-item:abc-123");
    expect(id).toBe("abc-123");
  });
  test("returns undefined for wrong scheme", () => {
    expect(parseItemUri("file:///foo")).toBeUndefined();
  });
});

describe("formatItemMarkdown", () => {
  test("renders title, service, type, fields", () => {
    const md = formatItemMarkdown({
      id: "abc",
      service: "github",
      itemType: "pr",
      name: "Fix bug",
      modifiedAt: 1700000000000,
      extra: { url: "https://x" },
    } as Record<string, unknown>);
    expect(md).toContain("# Fix bug");
    expect(md).toContain("github");
    expect(md).toContain("pr");
  });

  test("handles missing fields gracefully", () => {
    const md = formatItemMarkdown({ id: "x" } as Record<string, unknown>);
    expect(md).toContain("# Untitled");
  });
});
