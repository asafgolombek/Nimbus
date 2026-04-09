import { describe, expect, test } from "bun:test";

import { extractFirstMarkdownFenceBody } from "./json-fence.ts";

describe("extractFirstMarkdownFenceBody", () => {
  test("parses ```json fence", () => {
    const body = extractFirstMarkdownFenceBody('```json\n{"intent":"unknown"}\n```');
    expect(body).toBe('{"intent":"unknown"}');
  });

  test("parses plain ``` fence", () => {
    const body = extractFirstMarkdownFenceBody('```\n{"a":1}\n```');
    expect(body).toBe('{"a":1}');
  });

  test("returns undefined when no closing fence", () => {
    expect(extractFirstMarkdownFenceBody("```json\n{")).toBeUndefined();
  });

  test("returns undefined when no fence", () => {
    expect(extractFirstMarkdownFenceBody('{"x":1}')).toBeUndefined();
  });
});
