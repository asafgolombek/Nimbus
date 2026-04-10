import { describe, expect, test } from "bun:test";

import { shortIndexedMessageTitleFromPreview } from "./sync-message-preview-title.ts";

describe("shortIndexedMessageTitleFromPreview", () => {
  test("uses fallback when preview is blank", () => {
    expect(shortIndexedMessageTitleFromPreview("   ", "(empty)")).toBe("(empty)");
  });

  test("truncates long trimmed preview", () => {
    const long = `${"x".repeat(121)}`;
    expect(shortIndexedMessageTitleFromPreview(long, "x")).toBe(`${"x".repeat(117)}…`);
  });

  test("returns short preview unchanged", () => {
    expect(shortIndexedMessageTitleFromPreview("hello", "x")).toBe("hello");
  });
});
