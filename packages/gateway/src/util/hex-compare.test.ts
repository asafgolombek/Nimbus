import { describe, expect, test } from "bun:test";
import { sha256HexEqualConstantTime } from "./hex-compare.ts";

const HEX_A = "0".repeat(64);
const HEX_B = "0".repeat(63) + "1";
const HEX_C = "f".repeat(64);

describe("sha256HexEqualConstantTime", () => {
  test("equal full-length hashes return true", () => {
    expect(sha256HexEqualConstantTime(HEX_A, HEX_A)).toBe(true);
    expect(sha256HexEqualConstantTime(HEX_C, HEX_C)).toBe(true);
  });

  test("differ-by-one-bit returns false", () => {
    expect(sha256HexEqualConstantTime(HEX_A, HEX_B)).toBe(false);
  });

  test("length mismatch returns false (no throw)", () => {
    expect(sha256HexEqualConstantTime("abc", "abcd")).toBe(false);
    expect(sha256HexEqualConstantTime(HEX_A, "abc")).toBe(false);
  });

  test("non-64-char inputs return false", () => {
    expect(sha256HexEqualConstantTime("abc", "abc")).toBe(false);
  });

  test("invalid hex characters return false", () => {
    expect(sha256HexEqualConstantTime("z".repeat(64), "z".repeat(64))).toBe(false);
    expect(sha256HexEqualConstantTime(HEX_A, "z".repeat(64))).toBe(false);
  });

  test("uppercase and lowercase variants compare equal", () => {
    const lower = "abc123def456".padEnd(64, "0");
    const upper = lower.toUpperCase();
    expect(sha256HexEqualConstantTime(lower, upper)).toBe(true);
  });
});
