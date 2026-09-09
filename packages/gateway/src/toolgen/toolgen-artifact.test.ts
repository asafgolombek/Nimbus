import { describe, expect, test } from "bun:test";
import { artifactDigest, canonicalArtifactBytes } from "./toolgen-artifact.ts";
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
});
