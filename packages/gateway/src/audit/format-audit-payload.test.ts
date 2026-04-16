import { describe, expect, test } from "bun:test";

import { formatAuditPayload } from "./format-audit-payload.ts";

describe("formatAuditPayload", () => {
  test("returns JSON unchanged when under cap", () => {
    expect(formatAuditPayload({ a: 1 })).toBe('{"a":1}');
  });

  test("truncates long serialized payloads", () => {
    const big = "x".repeat(5000);
    const s = formatAuditPayload({ big }, 100);
    expect(s.endsWith("…[truncated]")).toBe(true);
    expect(s.length).toBeLessThanOrEqual(112);
  });
});
