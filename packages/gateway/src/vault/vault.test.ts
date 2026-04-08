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
    expect(isWellFormedVaultKey("9mail.oauth")).toBe(false);
    expect(isWellFormedVaultKey("gmail.o auth")).toBe(false);
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

  test("delete on missing key is a no-op", async () => {
    const v = new MockVault();
    await expect(v.delete("nope.here")).resolves.toBeUndefined();
  });

  test("listKeys returns key names only, never secret values", async () => {
    const v = new MockVault();
    const secret = "super-secret-payload-unique-77291";
    await v.set("svc.token", secret);
    const keys = await v.listKeys();
    expect(keys).toEqual(["svc.token"]);
    expect(keys.some((k) => k.includes(secret))).toBe(false);
    expect(keys).not.toContain(secret);
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
      socketPath: String.raw`\\.\pipe\nimbus-vault-test`,
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

  test("get on missing key returns null without throwing", async () => {
    if (process.platform !== "win32") {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), "nimbus-vault-dpapi-miss-"));
    const paths: PlatformPaths = {
      configDir: root,
      dataDir: join(root, "data"),
      logDir: join(root, "logs"),
      socketPath: String.raw`\\.\pipe\nimbus-vault-miss`,
      extensionsDir: join(root, "ext"),
      tempDir: join(root, "tmp"),
    };
    const { DpapiVault } = await import("./win32.ts");
    const v = new DpapiVault(paths);
    expect(await v.get("missing.key")).toBeNull();
  });

  test("delete on missing key is a no-op", async () => {
    if (process.platform !== "win32") {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), "nimbus-vault-dpapi-del-"));
    const paths: PlatformPaths = {
      configDir: root,
      dataDir: join(root, "data"),
      logDir: join(root, "logs"),
      socketPath: String.raw`\\.\pipe\nimbus-vault-del`,
      extensionsDir: join(root, "ext"),
      tempDir: join(root, "tmp"),
    };
    const { DpapiVault } = await import("./win32.ts");
    const v = new DpapiVault(paths);
    await expect(v.delete("absent.key")).resolves.toBeUndefined();
  });
});

describe("DarwinKeychainVault (macOS)", () => {
  test("set, get, delete, listKeys round-trip via Keychain", async () => {
    if (process.platform !== "darwin") {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), "nimbus-vault-keychain-"));
    const paths: PlatformPaths = {
      configDir: root,
      dataDir: join(root, "data"),
      logDir: join(root, "logs"),
      socketPath: join(root, "nimbus-gateway.sock"),
      extensionsDir: join(root, "ext"),
      tempDir: join(root, "tmp"),
    };
    const { DarwinKeychainVault } = await import("./darwin.ts");
    const v = new DarwinKeychainVault(paths);
    const key = "ci.smoke";
    await v.set(key, "darwin-round-trip");
    expect(await v.get(key)).toBe("darwin-round-trip");
    expect(await v.listKeys()).toContain(key);
    expect(await v.listKeys("ci.")).toEqual([key]);
    await v.delete(key);
    expect(await v.get(key)).toBeNull();
  });
});

describe("LinuxSecretToolVault (Linux)", () => {
  test("set, get, delete, listKeys round-trip via secret-tool", async () => {
    if (process.platform !== "linux") {
      return;
    }
    const { LinuxSecretToolVault } = await import("./linux.ts");
    const v = new LinuxSecretToolVault();
    const key = `ci.t_${Date.now()}`;
    await v.set(key, "linux-round-trip");
    expect(await v.get(key)).toBe("linux-round-trip");
    expect(await v.listKeys("ci.")).toContain(key);
    await v.delete(key);
    expect(await v.get(key)).toBeNull();
  });
});
