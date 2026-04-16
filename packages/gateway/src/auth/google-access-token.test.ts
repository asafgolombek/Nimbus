import { describe, expect, test } from "bun:test";

import { createMemoryVault } from "../testing/bun-test-support.ts";
import { anyGoogleOAuthVaultPresent, resolveGoogleOAuthVaultKey } from "./google-access-token.ts";

describe("resolveGoogleOAuthVaultKey", () => {
  test("prefers per-service key when non-empty", async () => {
    const vault = createMemoryVault();
    await vault.set("google_gmail.oauth", '{"accessToken":"a","refreshToken":"r","expiresAt":9}');
    await vault.set("google.oauth", '{"accessToken":"shared","refreshToken":"rs","expiresAt":9}');
    expect(await resolveGoogleOAuthVaultKey(vault, "gmail")).toBe("google_gmail.oauth");
  });

  test("falls back to google.oauth when per-service is empty", async () => {
    const vault = createMemoryVault();
    await vault.set("google.oauth", '{"accessToken":"s","refreshToken":"r","expiresAt":9}');
    expect(await resolveGoogleOAuthVaultKey(vault, "google_drive")).toBe("google.oauth");
  });

  test("returns null when no credential exists", async () => {
    const vault = createMemoryVault();
    expect(await resolveGoogleOAuthVaultKey(vault, "google_photos")).toBeNull();
  });
});

describe("anyGoogleOAuthVaultPresent", () => {
  test("is false for empty vault", async () => {
    const vault = createMemoryVault();
    expect(await anyGoogleOAuthVaultPresent(vault)).toBe(false);
  });

  test("is true when any Google OAuth key is set", async () => {
    const vault = createMemoryVault();
    await vault.set("google_drive.oauth", "{}");
    expect(await anyGoogleOAuthVaultPresent(vault)).toBe(true);
  });
});
