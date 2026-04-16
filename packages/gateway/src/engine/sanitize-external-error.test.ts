import { describe, expect, test } from "bun:test";

import { sanitizeExternalError } from "./sanitize-external-error.ts";

describe("sanitizeExternalError", () => {
  test("redacts key=value style secret substrings", () => {
    const msg = "Request failed: api_key=supersecretvaluehere and ok";
    expect(sanitizeExternalError(new Error(msg))).toBe("Request failed: api_[REDACTED] and ok");
  });

  test("handles non-Error input", () => {
    expect(sanitizeExternalError("token: abcdefghijklmnop")).toBe("[REDACTED]");
  });
});
