import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PlatformPaths } from "../platform/paths.ts";
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

  test("rejects malformed keys without echoing secret material", async () => {
    const v = new MockVault();
    const secret = "x".repeat(4000);
    try {
      await v.set("not_a_key", secret);
      expect.unreachable();
    } catch (e: unknown) {
      expect(String(e)).toContain("Invalid vault key format");
      expect(String(e)).not.toContain(secret);
    }
    await expect(v.get("!!!")).rejects.toThrow("Invalid vault key format");
    await expect(v.delete("")).rejects.toThrow("Invalid vault key format");
  });
});

describe("DpapiVault (Windows)", () => {
  test("set, get, delete, listKeys round-trip via DPAPI", async () => {
    if (process.platform !== "win32") {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), "nimbus-vault-dpapi-"));
    const paths: PlatformPaths = {
      configDir: root,
      dataDir: join(root, "data"),
      logDir: join(root, "logs"),
      socketPath: "\\\\.\\pipe\\nimbus-vault-test",
      extensionsDir: join(root, "ext"),
      tempDir: join(root, "tmp"),
    };
    const { DpapiVault } = await import("./win32.ts");
    const v = new DpapiVault(paths);
    await v.set("svc.token", "round-trip-secret");
    expect(await v.get("svc.token")).toBe("round-trip-secret");
    expect(await v.listKeys()).toEqual(["svc.token"]);
    expect(await v.listKeys("svc.")).toEqual(["svc.token"]);
    await v.delete("svc.token");
    expect(await v.get("svc.token")).toBeNull();
  });
});
