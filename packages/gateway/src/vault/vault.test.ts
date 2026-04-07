import { describe, expect, test } from "bun:test";
import { isWellFormedVaultKey } from "./index.ts";

describe("vault key validation", () => {
  test("accepts documented service.type shape", () => {
    expect(isWellFormedVaultKey("gmail.oauth")).toBe(true);
    expect(isWellFormedVaultKey("OneDrive.Refresh")).toBe(true);
  });

  test("rejects empty and oversize keys", () => {
    expect(isWellFormedVaultKey("")).toBe(false);
    expect(isWellFormedVaultKey(`${"x".repeat(255)}.y`)).toBe(false);
  });

  test("rejects malformed segments", () => {
    expect(isWellFormedVaultKey(".oauth")).toBe(false);
    expect(isWellFormedVaultKey("gmail.")).toBe(false);
    expect(isWellFormedVaultKey("gmail..oauth")).toBe(false);
    expect(isWellFormedVaultKey("gmail.oauth.extra")).toBe(false);
  });
});
