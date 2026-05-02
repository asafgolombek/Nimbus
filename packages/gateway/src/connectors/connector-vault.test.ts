import { describe, expect, test } from "bun:test";

import { createMemoryVault } from "../testing/bun-test-support.ts";
import {
  type ConnectorSecretKeyOf,
  readConnectorSecret,
  sharedOAuthKey,
} from "./connector-vault.ts";

// Type-equality probe (Hilger). Two type parameters are equal iff both are
// assignable in both directions when wrapped in identity-typed arrow functions.
// Used below to pin `ConnectorSecretKeyOf<S>` to specific union literals so
// that any silent widening (e.g. to `string`) fails compile, not just runtime.
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

function assertEq<_A, _B>(_: Eq<_A, _B>): void {
  // Intentionally empty: assertion happens at the type-checker, not at runtime.
}

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

describe("ConnectorSecretKeyOf — type pins", () => {
  // These pins fail at compile time if `ConnectorSecretKeyOf<S>` ever silently
  // widens to `string` or drifts from the manifest's bare-key suffix union.
  // The earlier `@ts-expect-error` directives only assert that bad inputs are
  // rejected; they would still pass if the type were `string` (which accepts
  // every literal including the misspelled ones, plus everything else).
  test("pins to manifest-derived bare-key suffixes (compile-time)", () => {
    assertEq<ConnectorSecretKeyOf<"github">, "pat">(true);
    assertEq<ConnectorSecretKeyOf<"slack">, "oauth">(true);
    assertEq<ConnectorSecretKeyOf<"linear">, "api_key">(true);
    assertEq<ConnectorSecretKeyOf<"gitlab">, "pat" | "api_base">(true);
    assertEq<ConnectorSecretKeyOf<"datadog">, "api_key" | "app_key" | "site">(true);
    assertEq<ConnectorSecretKeyOf<"bitbucket">, "username" | "app_password">(true);

    // Empty-manifest services must resolve to `never`, not `string`. This is
    // the main defence the `[T] extends [never]` non-distributive guard in
    // ConnectorSecretKeyOf was added for.
    assertEq<ConnectorSecretKeyOf<"google_drive">, never>(true);
    assertEq<ConnectorSecretKeyOf<"gmail">, never>(true);
    assertEq<ConnectorSecretKeyOf<"google_photos">, never>(true);
    assertEq<ConnectorSecretKeyOf<"onedrive">, never>(true);
    assertEq<ConnectorSecretKeyOf<"outlook">, never>(true);
    assertEq<ConnectorSecretKeyOf<"teams">, never>(true);
    assertEq<ConnectorSecretKeyOf<"github_actions">, never>(true);

    // Negative pins prove the equality probe distinguishes the cases above
    // from the most plausible regression (silent widening to `string`).
    // @ts-expect-error — `ConnectorSecretKeyOf<"github">` is `"pat"`, not `string`.
    assertEq<ConnectorSecretKeyOf<"github">, string>(true);
    // @ts-expect-error — `ConnectorSecretKeyOf<"google_drive">` is `never`, not `string`.
    assertEq<ConnectorSecretKeyOf<"google_drive">, string>(true);

    expect(true).toBe(true);
  });
});

describe("sharedOAuthKey", () => {
  test("returns google.oauth for google", () => {
    expect(sharedOAuthKey("google")).toBe("google.oauth");
  });

  test("returns microsoft.oauth for microsoft", () => {
    expect(sharedOAuthKey("microsoft")).toBe("microsoft.oauth");
  });

  test("compile-time: rejects non-provider strings", () => {
    // @ts-expect-error — SharedOAuthProvider is "google" | "microsoft" only.
    void sharedOAuthKey("github");
    expect(true).toBe(true);
  });
});
