import { describe, expect, test } from "bun:test";

import { createMemoryVault } from "../testing/bun-test-support.ts";
import { readMicrosoftOAuthScopesForOutlookEnv } from "./oauth-vault-tokens.ts";

describe("readMicrosoftOAuthScopesForOutlookEnv", () => {
  test("returns undefined when vault empty or scopes missing", async () => {
    const vault = createMemoryVault();
    expect(await readMicrosoftOAuthScopesForOutlookEnv(vault)).toBeUndefined();

    await vault.set(
      "microsoft.oauth",
      JSON.stringify({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: Date.now() + 60_000,
      }),
    );
    expect(await readMicrosoftOAuthScopesForOutlookEnv(vault)).toBeUndefined();
  });

  test("returns space-separated scopes when present", async () => {
    const vault = createMemoryVault();
    await vault.set(
      "microsoft.oauth",
      JSON.stringify({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: Date.now() + 60_000,
        scopes: ["Calendars.Read", "offline_access"],
      }),
    );
    expect(await readMicrosoftOAuthScopesForOutlookEnv(vault)).toBe(
      "Calendars.Read offline_access",
    );
  });
});
