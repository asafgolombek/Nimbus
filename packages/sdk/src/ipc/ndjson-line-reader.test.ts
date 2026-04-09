import { describe, expect, test } from "bun:test";

import { IPC_MAX_LINE_BYTES, NdjsonLineReader } from "./ndjson-line-reader.ts";

describe("NdjsonLineReader", () => {
  test("emits non-empty lines and skips blanks", () => {
    const r = new NdjsonLineReader();
    const lines = r.push(new TextEncoder().encode('{"a":1}\n\n{"b":2}\n'));
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  test("throws when a line exceeds IPC_MAX_LINE_BYTES", () => {
    const r = new NdjsonLineReader();
    const huge = `${"x".repeat(IPC_MAX_LINE_BYTES + 1)}\n`;
    expect(() => r.push(new TextEncoder().encode(huge))).toThrow("Message exceeds 1MB line limit");
  });
});
