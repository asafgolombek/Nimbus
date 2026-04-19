import { describe, expect, test } from "bun:test";
import { computeAuditRowHash, GENESIS_HASH } from "./audit-chain.ts";

describe("computeAuditRowHash", () => {
  test("is deterministic for identical inputs", () => {
    const row = {
      prevHash: GENESIS_HASH,
      actionType: "a",
      hitlStatus: "approved",
      actionJson: "{}",
      timestamp: 1,
    };
    expect(computeAuditRowHash(row)).toBe(computeAuditRowHash(row));
  });

  test("differs when any field differs", () => {
    const base = {
      prevHash: GENESIS_HASH,
      actionType: "a",
      hitlStatus: "approved",
      actionJson: "{}",
      timestamp: 1,
    };
    const mutated = { ...base, actionType: "b" };
    expect(computeAuditRowHash(base)).not.toBe(computeAuditRowHash(mutated));
  });

  test("returns 64-char lowercase hex", () => {
    const h = computeAuditRowHash({
      prevHash: GENESIS_HASH,
      actionType: "a",
      hitlStatus: "approved",
      actionJson: "{}",
      timestamp: 1,
    });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test("GENESIS_HASH is 64 zeros", () => {
    expect(GENESIS_HASH).toBe("0".repeat(64));
  });

  test("changes when prevHash changes (chain linkage)", () => {
    const row = { actionType: "a", hitlStatus: "approved", actionJson: "{}", timestamp: 1 };
    const a = computeAuditRowHash({ ...row, prevHash: GENESIS_HASH });
    const b = computeAuditRowHash({ ...row, prevHash: "deadbeef".repeat(8) });
    expect(a).not.toBe(b);
  });
});
