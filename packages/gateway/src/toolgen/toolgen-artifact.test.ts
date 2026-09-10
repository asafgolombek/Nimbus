import { describe, expect, test } from "bun:test";
import { artifactDigest, canonicalArtifactBytes } from "./toolgen-artifact.ts";
import { validateInputSchema } from "./toolgen-schema.ts";
import type { GeneratedToolArtifact } from "./toolgen-types.ts";

function artifact(overrides: Partial<GeneratedToolArtifact> = {}): GeneratedToolArtifact {
  return {
    toolId: "tg_abc",
    toolName: "gitea_open_prs",
    description: "List open PRs",
    body: "export async function run() { return 1; }",
    approvedHosts: ["api.gitea.example"],
    credentialHosts: ["api.gitea.example"],
    manifest: {
      id: "toolgen.tg_abc",
      version: "0.0.0",
      permissions: { network: [], filesystem: { read: [], write: [] } },
      updateChannel: "stable",
    },
    inputSchema: { type: "object", properties: {} },
    ...overrides,
  };
}

describe("canonical artifact", () => {
  test("key order in the input does not change the bytes", () => {
    const a = artifact();
    const reordered = { ...artifact() } as Record<string, unknown>;
    const rebuilt = Object.fromEntries(
      Object.entries(reordered).reverse(),
    ) as unknown as GeneratedToolArtifact;
    expect(canonicalArtifactBytes(rebuilt)).toBe(canonicalArtifactBytes(a));
  });

  test("the digest changes when the BODY changes", () => {
    expect(artifactDigest(artifact({ body: "x" }))).not.toBe(
      artifactDigest(artifact({ body: "y" })),
    );
  });

  test("the digest changes when an approved HOST changes", () => {
    expect(artifactDigest(artifact())).not.toBe(
      artifactDigest(artifact({ approvedHosts: ["api.evil.example"] })),
    );
  });

  test("the digest changes when a CREDENTIAL BINDING changes", () => {
    expect(artifactDigest(artifact())).not.toBe(artifactDigest(artifact({ credentialHosts: [] })));
  });

  test("the digest changes when the INPUT SCHEMA changes — the owner approves the parameters too", () => {
    expect(artifactDigest(artifact({ inputSchema: { type: "object", properties: {} } }))).not.toBe(
      artifactDigest(
        artifact({
          inputSchema: {
            type: "object",
            properties: { owner: { type: "string" } },
          },
        }),
      ),
    );
  });

  test("the digest is STABLE when the input schema's properties are inserted in a different order", () => {
    const a = artifact({
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
        },
      },
    });
    const b = artifact({
      inputSchema: {
        type: "object",
        properties: {
          repo: { type: "string" },
          owner: { type: "string" },
        },
      },
    });
    expect(artifactDigest(a)).toBe(artifactDigest(b));
  });

  test("the digest is IDENTICAL whether `required` was omitted or an explicit empty array — same schema, same canonical bytes", () => {
    const omitted = artifact({
      inputSchema: validateInputSchema({ type: "object", properties: {} }),
    });
    const explicitEmpty = artifact({
      inputSchema: validateInputSchema({ type: "object", properties: {}, required: [] }),
    });
    expect(artifactDigest(explicitEmpty)).toBe(artifactDigest(omitted));
  });
});
