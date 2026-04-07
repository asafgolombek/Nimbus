import { describe, expect, test } from "bun:test";
import { isWellFormedVaultKey } from "./index.ts";
import { MockVault } from "./mock.ts";

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

describe("MockVault", () => {
  test("get returns null for missing keys", async () => {
    const v = new MockVault();
    expect(await v.get("none.here")).toBeNull();
  });

  test("set, get, delete, listKeys", async () => {
    const v = new MockVault();
    await v.set("svc.token", "a");
    await v.set("svc.other", "b");
    await v.set("other.x", "c");
    expect(await v.get("svc.token")).toBe("a");
    await v.delete("svc.token");
    expect(await v.get("svc.token")).toBeNull();
    expect(await v.listKeys()).toEqual(["other.x", "svc.other"]);
    expect(await v.listKeys("svc.")).toEqual(["svc.other"]);
  });
});
