import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { isAllowedMetaKey, LocalIndex } from "./local-index.ts";

describe("LocalIndex meta whitelist (S4-F1)", () => {
  test("setMeta accepts whitelisted key onboarding_completed", () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const idx = new LocalIndex(db);
    expect(() => idx.setMeta("onboarding_completed", "2026-04-26T00:00:00Z")).not.toThrow();
    expect(idx.getMeta("onboarding_completed")).toBe("2026-04-26T00:00:00Z");
  });

  test("setMeta rejects keys outside the whitelist", () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const idx = new LocalIndex(db);
    expect(() => idx.setMeta("nimbus_config", "x")).toThrow(/whitelist/i);
    expect(() => idx.setMeta("vault_master_key", "x")).toThrow(/whitelist/i);
  });

  test("getMeta on whitelisted but unset key returns null", () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const idx = new LocalIndex(db);
    expect(idx.getMeta("onboarding_completed")).toBeNull();
  });

  test("getMeta also rejects keys outside the whitelist", () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const idx = new LocalIndex(db);
    expect(() => idx.getMeta("nimbus_config")).toThrow(/whitelist/i);
  });

  test("isAllowedMetaKey reports correct membership", () => {
    expect(isAllowedMetaKey("onboarding_completed")).toBe(true);
    expect(isAllowedMetaKey("anything_else")).toBe(false);
  });
});
