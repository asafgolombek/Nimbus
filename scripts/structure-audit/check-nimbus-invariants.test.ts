import { describe, expect, test } from "bun:test";
import {
  checkSpawnInvariant,
  checkVaultKeyAllowList,
  collectDbRunCensus,
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
