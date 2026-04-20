import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileManager } from "./profiles.ts";

describe("ProfileManager", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nimbus-profiles-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("list returns empty array before any profile is created", async () => {
    const mgr = new ProfileManager(dir);
    expect(await mgr.list()).toEqual([]);
    expect(await mgr.getActive()).toBeUndefined();
  });

  test("create + switch + list round trip", async () => {
    const mgr = new ProfileManager(dir);
    await mgr.create("work");
    await mgr.create("personal");
    await mgr.switchTo("personal");
    const profiles = await mgr.list();
    expect(profiles.map((p) => p.name).sort((a, b) => a.localeCompare(b))).toEqual([
      "personal",
      "work",
    ]);
    expect(profiles.find((p) => p.active)?.name).toBe("personal");
  });

  test("delete removes the profile file and clears active if needed", async () => {
    const mgr = new ProfileManager(dir);
    await mgr.create("work");
    await mgr.create("personal");
    await mgr.switchTo("work");
    await mgr.delete("personal");
    const profiles = await mgr.list();
    expect(profiles.map((p) => p.name)).toEqual(["work"]);
  });

  test("delete refuses the active profile", async () => {
    const mgr = new ProfileManager(dir);
    await mgr.create("work");
    await mgr.switchTo("work");
    await expect(mgr.delete("work")).rejects.toThrow(/active/i);
  });

  test("create rejects invalid names", async () => {
    const mgr = new ProfileManager(dir);
    await expect(mgr.create("bad name!")).rejects.toThrow();
    await expect(mgr.create("default")).rejects.toThrow();
  });

  test("vaultKeyPrefix returns empty string for default profile", async () => {
    const mgr = new ProfileManager(dir);
    expect(mgr.vaultKeyPrefix()).toBe("");
  });

  test("vaultKeyPrefix returns profile/ prefix after switch", async () => {
    const mgr = new ProfileManager(dir);
    await mgr.create("work");
    await mgr.switchTo("work");
    expect(mgr.vaultKeyPrefix()).toBe("profile/work/");
  });
});
