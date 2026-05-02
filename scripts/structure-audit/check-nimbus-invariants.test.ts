import { describe, expect, test } from "bun:test";
import { CONNECTOR_VAULT_SECRET_KEYS } from "../../packages/gateway/src/connectors/connector-secrets-manifest.ts";
import {
  checkSpawnInvariant,
  checkVaultKeyAllowList,
  collectDbRunCensus,
  VAULT_KEY_ALLOW_LIST,
} from "./check-nimbus-invariants.ts";

describe("D10 — checkSpawnInvariant (under connectors/)", () => {
  test("flags `Bun.spawn` not via extensionProcessEnv", () => {
    const violations = checkSpawnInvariant([
      {
        relPath: "packages/gateway/src/connectors/lazy-mesh.ts",
        contents: 'const p = Bun.spawn(["x"], { env: { ...process.env } });',
      },
    ]);
    expect(violations).toHaveLength(1);
  });

  test("accepts spawn that calls extensionProcessEnv", () => {
    const violations = checkSpawnInvariant([
      {
        relPath: "packages/gateway/src/connectors/lazy-mesh.ts",
        contents: 'const p = Bun.spawn(["x"], { env: extensionProcessEnv() });',
      },
    ]);
    expect(violations).toHaveLength(0);
  });

  test("ignores spawn outside connectors/", () => {
    const violations = checkSpawnInvariant([
      {
        relPath: "packages/gateway/src/voice/service.ts",
        contents: 'const p = Bun.spawn(["whisper"], { env: { ...process.env } });',
      },
    ]);
    expect(violations).toHaveLength(0);
  });
});

describe("D11 — checkVaultKeyAllowList", () => {
  const ALLOW_LIST = [
    "packages/gateway/src/connectors/connector-vault.ts",
    "packages/gateway/src/auth/google-access-token.ts",
    "packages/gateway/src/auth/pkce.ts",
  ];

  test("flags vault-key construction outside allow-list", () => {
    const violations = checkVaultKeyAllowList(
      [
        {
          relPath: "packages/gateway/src/connectors/some-other.ts",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: source-text fixture under audit
          contents: "const k = `${service}.oauth`;",
        },
      ],
      ALLOW_LIST,
    );
    expect(violations).toHaveLength(1);
  });

  test("ignores construction in allow-listed files", () => {
    const violations = checkVaultKeyAllowList(
      [
        {
          relPath: "packages/gateway/src/connectors/connector-vault.ts",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: source-text fixture under audit
          contents: "export function k(s: string) { return `${s}.oauth`; }",
        },
      ],
      ALLOW_LIST,
    );
    expect(violations).toHaveLength(0);
  });

  test("ignores vault-key when previous line has audit-ignore-next-line D11-vault-key marker", () => {
    const violations = checkVaultKeyAllowList(
      [
        {
          relPath: "packages/gateway/src/connectors/some-other.ts",
          contents:
            "// audit-ignore-next-line D11-vault-key (manifest entry, not vault-key construction)\n" +
            'const entry = "slack.oauth";',
        },
      ],
      ALLOW_LIST,
    );
    expect(violations).toHaveLength(0);
  });

  test("still flags vault-key when no opt-out marker is on previous line", () => {
    const violations = checkVaultKeyAllowList(
      [
        {
          relPath: "packages/gateway/src/connectors/some-other.ts",
          contents: "// just a regular comment\n" + 'const entry = "slack.oauth";',
        },
      ],
      ALLOW_LIST,
    );
    expect(violations).toHaveLength(1);
  });
});

describe("D11 — VAULT_KEY_ALLOW_LIST is frozen at structural entries", () => {
  test("VAULT_KEY_ALLOW_LIST has exactly 6 entries", () => {
    // Each entry has a documented structural reason. The first 5 land in the
    // structure-audit design spec § 4.4 (helper home, Google OAuth canonical
    // reader, Google PKCE writer, Microsoft provider-shared OAuth, OpenAI
    // embedding provider). The 6th — connector-secrets-manifest.ts — was
    // added in the manifest-derived widening spec (2026-05-02) as the
    // canonical declaration site for per-connector vault keys.
    expect(VAULT_KEY_ALLOW_LIST).toHaveLength(6);
  });
});

describe("D11 — manifest-derived VAULT_KEY_RE", () => {
  test("matches representative manifest entries", () => {
    const keys = Object.values(CONNECTOR_VAULT_SECRET_KEYS).flat();
    // Spot-check each suffix family present in the manifest.
    for (const sample of [
      "jira.api_token",
      "aws.access_key_id",
      "bitbucket.app_password",
      "datadog.app_key",
      "iac.enabled",
    ]) {
      expect(keys).toContain(sample);
      expect(`vault.set("${sample}", x)`).toMatch(/['"`][a-z0-9_]+\.[a-z0-9_]+['"`]/);
    }
  });

  test("does not match non-manifest literals", () => {
    const keys = Object.values(CONNECTOR_VAULT_SECRET_KEYS).flat();
    expect(keys).not.toContain("console.log");
    expect(keys).not.toContain("path.to.file");
  });
});

describe("D12 — collectDbRunCensus", () => {
  test("collects db.run() outside db/write.ts", () => {
    const census = collectDbRunCensus([
      {
        relPath: "packages/gateway/src/something/foo.ts",
        contents: "function bar() {\n  db.run('CREATE TABLE x ...');\n}",
      },
    ]);
    expect(census).toEqual([
      {
        file: "packages/gateway/src/something/foo.ts",
        line: 2,
        function: "bar",
        snippet: "db.run('CREATE TABLE x ...');",
      },
    ]);
  });

  test("ignores db.run() inside db/write.ts (the wrapper)", () => {
    const census = collectDbRunCensus([
      {
        relPath: "packages/gateway/src/db/write.ts",
        contents: "db.run('SELECT 1');",
      },
    ]);
    expect(census).toHaveLength(0);
  });
});
