import { describe, expect, test } from "bun:test";

import { detectFallbackReason, type FallbackEnv } from "./detect-fallback.ts";

function env(overrides: Partial<FallbackEnv> = {}): FallbackEnv {
  return {
    TERM: "xterm-256color",
    NO_COLOR: undefined,
    CI: undefined,
    isTTY: true,
    columns: 120,
    rows: 40,
    ...overrides,
  };
}

describe("detectFallbackReason", () => {
  test("returns null for a reasonable terminal", () => {
    expect(detectFallbackReason(env())).toBeNull();
  });

  test("TERM=dumb triggers fallback", () => {
    expect(detectFallbackReason(env({ TERM: "dumb" }))).toBe("TERM=dumb");
  });

  test("NO_COLOR set triggers fallback, regardless of value", () => {
    expect(detectFallbackReason(env({ NO_COLOR: "" }))).toBe("NO_COLOR");
    expect(detectFallbackReason(env({ NO_COLOR: "1" }))).toBe("NO_COLOR");
    expect(detectFallbackReason(env({ NO_COLOR: "true" }))).toBe("NO_COLOR");
  });

  test("non-TTY stdout triggers fallback", () => {
    expect(detectFallbackReason(env({ isTTY: false }))).toBe("non-TTY");
  });

  test("CI=true triggers fallback; CI=false does not", () => {
    expect(detectFallbackReason(env({ CI: "true" }))).toBe("CI=true");
    expect(detectFallbackReason(env({ CI: "false" }))).toBeNull();
  });

  test("rows below MIN_HEIGHT_THRESHOLD triggers fallback", () => {
    expect(detectFallbackReason(env({ rows: 10 }))).toBe("rows-too-small");
  });

  test("only one reason is returned — first-match wins", () => {
    const reason = detectFallbackReason(env({ TERM: "dumb", NO_COLOR: "1", CI: "true", rows: 5 }));
    expect(reason).toBe("TERM=dumb");
  });

  test("undefined rows (e.g., stdout.rows may be undefined) does not trigger", () => {
    expect(detectFallbackReason(env({ rows: undefined }))).toBeNull();
  });
});
