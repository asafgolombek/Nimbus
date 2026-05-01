import { describe, expect, test } from "bun:test";

import { createMemoryVault } from "../testing/bun-test-support.ts";
import { readConnectorSecret } from "./connector-vault.ts";

describe("readConnectorSecret", () => {
  test("returns the stored value when the key is set", async () => {
    const vault = createMemoryVault();
    await vault.set("github.pat", "ghp_test");
    expect(await readConnectorSecret(vault, "github", "pat")).toBe("ghp_test");
  });

  test("returns null when the key is absent", async () => {
    const vault = createMemoryVault();
    expect(await readConnectorSecret(vault, "github", "pat")).toBeNull();
  });

  test("does not trim or coerce empty string", async () => {
    const vault = createMemoryVault();
    await vault.set("slack.oauth", "  raw value  ");
    expect(await readConnectorSecret(vault, "slack", "oauth")).toBe("  raw value  ");

    await vault.set("notion.oauth", "");
    expect(await readConnectorSecret(vault, "notion", "oauth")).toBe("");
  });

  test("resolves api_key and app_key to distinct vault keys (datadog multi-key)", async () => {
    const vault = createMemoryVault();
    await vault.set("datadog.api_key", "API");
    await vault.set("datadog.app_key", "APP");
    expect(await readConnectorSecret(vault, "datadog", "api_key")).toBe("API");
    expect(await readConnectorSecret(vault, "datadog", "app_key")).toBe("APP");
  });

  test("resolves non-credential-shaped keys (gitlab.api_base)", async () => {
    const vault = createMemoryVault();
    await vault.set("gitlab.api_base", "https://gitlab.example.com/api/v4");
    expect(await readConnectorSecret(vault, "gitlab", "api_base")).toBe(
      "https://gitlab.example.com/api/v4",
    );
  });

  test("compile-time: rejects non-manifested keys", () => {
    const vault = createMemoryVault();
    // @ts-expect-error — manifest is ["github.pat"]; "oauth" is not a github key.
    void readConnectorSecret(vault, "github", "oauth");

    // @ts-expect-error — google_drive manifest is empty; ConnectorSecretKeyOf resolves to never.
    void readConnectorSecret(vault, "google_drive", "oauth");

    // The runtime expectation is irrelevant for these checks; the assertion
    // is that the file typechecks only with the @ts-expect-error directives.
    expect(true).toBe(true);
  });
});
